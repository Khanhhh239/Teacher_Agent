/**
 * Giãn nhịp lệnh gọi Gemini theo TỪNG MODEL để không chạm hạn mức free theo phút.
 * Đã đo trực tiếp (429 trả về kèm giá trị hạn mức): gemini-3.5-flash-lite và
 * gemini-3.1-flash-lite = 15 lệnh/phút; các model flash (3.5/3.7/3.8) = 5 lệnh/phút — tính
 * riêng từng model nên chia việc cho nhiều model được. Ta dùng ~80% hạn mức để chừa biên.
 *
 * Trạng thái nằm trong bộ nhớ của 1 instance serverless — chặn được dồn dập trong cùng 1
 * request/instance, KHÔNG phối hợp giữa các instance khác nhau (nhiều giáo viên cùng lúc vẫn
 * có thể chạm hạn mức: khi đó callGeminiRaw tự chờ theo retryDelay của Google).
 */
const nextFree = new Map<string, number>();

export function modelIntervalMs(model: string): number {
  return /lite/i.test(model) ? 5_000 : 13_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Chờ tới lượt gọi của `model`. Trả false (và không giữ chỗ) nếu lượt gọi sẽ rơi sau `deadline`
 * — để bên gọi bỏ qua việc đó thay vì làm request vượt giới hạn thời gian của Vercel.
 */
export async function waitForSlot(model: string, deadline?: number): Promise<boolean> {
  const interval = modelIntervalMs(model);
  const now = Date.now();
  const start = Math.max(now, nextFree.get(model) ?? 0);
  if (deadline !== undefined && start > deadline) return false;
  nextFree.set(model, start + interval);
  if (start > now) await sleep(start - now);
  return true;
}
