import Link from "next/link";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-50 px-4 text-center">
      <h1 className="text-3xl font-bold">Nền tảng Thi Trực tuyến Tự động hóa bằng AI</h1>
      <p className="max-w-md text-slate-600">
        Giáo viên upload đề thi, hệ thống tự bóc tách công thức toán và tạo phòng thi. Học sinh
        vào thi bằng mã phòng.
      </p>
      <div className="flex gap-4">
        <Link href="/login" className="rounded-md bg-slate-900 px-5 py-2.5 text-sm font-medium text-white">
          Giáo viên đăng nhập
        </Link>
        <Link href="/exam/join" className="rounded-md border px-5 py-2.5 text-sm font-medium">
          Học sinh vào thi
        </Link>
      </div>
    </div>
  );
}
