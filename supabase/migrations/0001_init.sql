-- ============================================================================
-- Nền tảng Thi Trực tuyến Tự động hóa bằng AI — Schema khởi tạo
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Giáo viên (mở rộng từ Supabase auth.users)
-- ----------------------------------------------------------------------------
create table if not exists public.teachers (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  created_at timestamptz not null default now()
);

alter table public.teachers enable row level security;

create policy "teachers can read own profile"
  on public.teachers for select
  using (auth.uid() = id);

create policy "teachers can update own profile"
  on public.teachers for update
  using (auth.uid() = id);

-- Tự động tạo hồ sơ teacher khi có user mới đăng ký
create or replace function public.handle_new_teacher()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.teachers (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_teacher();

-- ----------------------------------------------------------------------------
-- Đề thi
-- ----------------------------------------------------------------------------
create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers (id) on delete cascade,
  title text not null,
  subject text not null default '',
  duration_minutes integer not null default 90,
  status text not null default 'draft' check (status in ('draft', 'reviewing', 'ready', 'archived')),
  source_branch text check (source_branch in ('OMML_NATIVE', 'LEGACY_OLE_IMAGE', 'PDF_IMAGE_ONLY', 'PDF_TEXT_LAYER', 'MANUAL')),
  settings jsonb not null default '{}'::jsonb, -- vd: {"shuffle_questions": true, "shuffle_options": true, "anti_cheat": true}
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.exams enable row level security;

create policy "teachers manage own exams"
  on public.exams for all
  using (auth.uid() = teacher_id)
  with check (auth.uid() = teacher_id);

-- ----------------------------------------------------------------------------
-- Câu hỏi
-- ----------------------------------------------------------------------------
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  order_index integer not null,
  type text not null check (type in ('multiple_choice', 'true_false_group', 'short_answer')),
  content_latex text not null default '',
  image_url text,
  options jsonb not null default '[]'::jsonb,         -- [{key:'A', text_latex:'...'}]
  sub_statements jsonb not null default '[]'::jsonb,   -- [{key:'a', text_latex:'...', answer:true}]
  correct_answer text,                                  -- dùng cho multiple_choice
  short_answer_normalized text,                         -- dùng cho short_answer
  score_rule text not null default 'standard' check (score_rule in ('standard', 'thpt2025_truefalse_partial')),
  max_score numeric not null default 0.25,
  needs_review boolean not null default true,           -- OCR chưa được giáo viên duyệt
  raw_ocr_notes text,                                    -- ghi chú OCR gốc (để giáo viên đối chiếu)
  created_at timestamptz not null default now()
);

alter table public.questions enable row level security;

create policy "teachers manage questions of own exams"
  on public.questions for all
  using (exists (select 1 from public.exams e where e.id = exam_id and e.teacher_id = auth.uid()))
  with check (exists (select 1 from public.exams e where e.id = exam_id and e.teacher_id = auth.uid()));

create index if not exists idx_questions_exam_id on public.questions (exam_id, order_index);

-- ----------------------------------------------------------------------------
-- Phòng thi (mã thi)
-- ----------------------------------------------------------------------------
create table if not exists public.exam_rooms (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  code text not null unique,
  opens_at timestamptz,
  closes_at timestamptz,
  is_active boolean not null default true,
  require_fullscreen boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.exam_rooms enable row level security;

create policy "teachers manage rooms of own exams"
  on public.exam_rooms for all
  using (exists (select 1 from public.exams e where e.id = exam_id and e.teacher_id = auth.uid()))
  with check (exists (select 1 from public.exams e where e.id = exam_id and e.teacher_id = auth.uid()));

-- Không có policy select public — học sinh truy cập phòng thi qua API route
-- dùng service-role key phía server, không truy cập Supabase trực tiếp từ client.

-- ----------------------------------------------------------------------------
-- Phiên thi của học sinh
-- ----------------------------------------------------------------------------
create table if not exists public.exam_sessions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.exam_rooms (id) on delete cascade,
  student_name text not null,
  student_code text not null default '',
  question_order jsonb not null default '[]'::jsonb,  -- danh sách question_id theo thứ tự đã xáo
  option_order jsonb not null default '{}'::jsonb,     -- {question_id: ['C','A','D','B']}
  status text not null default 'in_progress' check (status in ('in_progress', 'submitted', 'graded')),
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  total_score numeric,
  violation_count integer not null default 0
);

create index if not exists idx_sessions_room_id on public.exam_sessions (room_id);

alter table public.exam_sessions enable row level security;

-- Học sinh không có tài khoản Supabase — mọi ghi/đọc của học sinh đi qua Route Handler
-- dùng service-role key. Giáo viên chỉ được xem (không sửa) session thuộc đề của mình.
create policy "teachers view sessions of own exams"
  on public.exam_sessions for select
  using (
    exists (
      select 1 from public.exam_rooms r
      join public.exams e on e.id = r.exam_id
      where r.id = room_id and e.teacher_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- Câu trả lời của học sinh
-- ----------------------------------------------------------------------------
create table if not exists public.student_answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.exam_sessions (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  answer jsonb not null default '{}'::jsonb, -- {"selected":"A"} | {"statements":{"a":true,...}} | {"text":"145"}
  is_correct boolean,
  score numeric,
  unique (session_id, question_id)
);

create index if not exists idx_answers_session_id on public.student_answers (session_id);

alter table public.student_answers enable row level security;

create policy "teachers view answers of own exams"
  on public.student_answers for select
  using (
    exists (
      select 1 from public.exam_sessions s
      join public.exam_rooms r on r.id = s.room_id
      join public.exams e on e.id = r.exam_id
      where s.id = session_id and e.teacher_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- Log vi phạm (anti-cheat: deterrent + logging, KHÔNG chặn tuyệt đối)
-- ----------------------------------------------------------------------------
create table if not exists public.exam_violations (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.exam_sessions (id) on delete cascade,
  type text not null, -- 'tab_blur' | 'fullscreen_exit' | 'devtools_key' | 'copy_paste' | 'right_click'
  occurred_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);

create index if not exists idx_violations_session_id on public.exam_violations (session_id);

alter table public.exam_violations enable row level security;

create policy "teachers view violations of own exams"
  on public.exam_violations for select
  using (
    exists (
      select 1 from public.exam_sessions s
      join public.exam_rooms r on r.id = s.room_id
      join public.exams e on e.id = r.exam_id
      where s.id = session_id and e.teacher_id = auth.uid()
    )
  );

-- Bật Realtime cho giáo viên xem vi phạm live (tuỳ chọn)
alter publication supabase_realtime add table public.exam_violations;

-- ----------------------------------------------------------------------------
-- Storage bucket cho ảnh đề thi
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('exam-images', 'exam-images', true)
on conflict (id) do nothing;

create policy "public read exam images"
  on storage.objects for select
  using (bucket_id = 'exam-images');

create policy "authenticated upload exam images"
  on storage.objects for insert
  with check (bucket_id = 'exam-images' and auth.role() = 'authenticated');
