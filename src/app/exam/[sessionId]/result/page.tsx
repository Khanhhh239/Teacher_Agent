"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";

/** Trang này không còn được điều hướng tới trong luồng bình thường (trang làm bài tự xử lý
 * màn hình "đã nộp bài" rồi đưa học sinh ra khỏi phòng thi) — giữ lại làm lối thoát an toàn
 * nếu ai đó mở thẳng URL này: không gọi API chấm điểm, không hiển thị điểm/đáp án. */
export default function ResultPage({ params }: { params: Promise<{ sessionId: string }> }) {
  use(params);
  const router = useRouter();

  useEffect(() => {
    const t = setTimeout(() => router.replace("/exam/join"), 1500);
    return () => clearTimeout(t);
  }, [router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-2 bg-slate-50 p-4 text-center">
      <div className="card max-w-sm p-6">
        <p className="text-lg font-semibold text-green-700">Đã nộp bài thành công</p>
        <p className="mt-1 text-sm text-slate-600">Kết quả sẽ được giáo viên công bố. Đang chuyển hướng...</p>
      </div>
    </div>
  );
}
