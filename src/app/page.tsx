import Link from "next/link";

export default function Home() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-slate-50 px-4 text-center">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_-10%,theme(colors.indigo.100),transparent_60%)]"
      />
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-600 text-2xl font-bold text-white shadow-lg shadow-indigo-200">
        AI
      </div>
      <h1 className="max-w-2xl text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
        Nền tảng Thi Trực tuyến Tự động hóa bằng AI
      </h1>
      <p className="mt-3 max-w-md text-slate-600">
        Giáo viên upload đề thi PDF, hệ thống tự cắt từng câu và tạo phòng thi. Học sinh vào thi
        bằng mã phòng, chấm điểm tự động.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/login"
          className="rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-sm shadow-indigo-200 transition hover:bg-indigo-700"
        >
          Giáo viên đăng nhập
        </Link>
        <Link
          href="/exam/join"
          className="rounded-lg border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50"
        >
          Học sinh vào thi
        </Link>
      </div>
    </div>
  );
}
