/**
 * Convert docx -> PDF qua CloudConvert API khi không có LibreOffice tại chỗ (Vercel
 * serverless không cài được binary LibreOffice — giới hạn đã biết từ đầu dự án). CloudConvert
 * chạy LibreOffice thật trên server họ nên công thức MathType/WMF cũ được render đúng như
 * Word hiển thị, không cần tự giải mã WMF (2 cách tự làm trước đó đều thất bại trên Vercel —
 * xem lịch sử commit llmClient.ts).
 *
 * Luồng: tạo job 3 bước (import/upload -> convert -> export/url) -> upload file lên URL
 * CloudConvert cấp -> chờ job xong (endpoint /wait, CloudConvert tự chờ hộ, không cần tự
 * poll) -> tải file PDF kết quả về.
 */

const CLOUDCONVERT_API = "https://api.cloudconvert.com/v2";

interface CloudConvertTask {
  id: string;
  name: string;
  status: string;
  result?: {
    form?: { url: string; parameters: Record<string, string> };
    files?: { filename: string; url: string }[];
  };
  message?: string;
}

interface CloudConvertJob {
  id: string;
  status: string;
  tasks: CloudConvertTask[];
}

function apiKey(): string {
  const key = process.env.CLOUDCONVERT_API_KEY;
  if (!key) throw new Error("Chưa cấu hình CLOUDCONVERT_API_KEY");
  return key;
}

async function cc<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${CLOUDCONVERT_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!res.ok) {
    throw new Error(`CloudConvert lỗi ${res.status}: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data.data as T;
}

/** Convert 1 file docx (hoặc bất kỳ định dạng Office nào) sang PDF, trả về buffer PDF. */
export async function convertToPdf(buffer: Buffer, filename: string): Promise<Buffer> {
  const job = await cc<CloudConvertJob>("/jobs", {
    method: "POST",
    body: JSON.stringify({
      tasks: {
        "import-file": { operation: "import/upload" },
        "convert-file": {
          operation: "convert",
          input: "import-file",
          output_format: "pdf",
          engine: "libreoffice",
        },
        "export-file": { operation: "export/url", input: "convert-file" },
      },
    }),
  });

  const importTask = job.tasks.find((t) => t.name === "import-file");
  const uploadForm = importTask?.result?.form;
  if (!uploadForm) throw new Error("CloudConvert không trả về form upload");

  const formData = new FormData();
  for (const [key, value] of Object.entries(uploadForm.parameters)) {
    formData.append(key, value);
  }
  formData.append("file", new Blob([new Uint8Array(buffer)]), filename);

  const uploadRes = await fetch(uploadForm.url, { method: "POST", body: formData });
  if (!uploadRes.ok) {
    throw new Error(`CloudConvert upload file thất bại: ${uploadRes.status} ${await uploadRes.text().catch(() => "")}`);
  }

  // Endpoint /wait tự chờ tới khi job xong (hoặc timeout phía CloudConvert) — không cần tự
  // viết vòng lặp poll.
  const finishedJob = await cc<CloudConvertJob>(`/jobs/${job.id}/wait`);
  if (finishedJob.status !== "finished") {
    const failedTask = finishedJob.tasks.find((t) => t.status === "error");
    throw new Error(`CloudConvert job không hoàn thành: ${failedTask?.message ?? finishedJob.status}`);
  }

  const exportTask = finishedJob.tasks.find((t) => t.name === "export-file");
  const fileUrl = exportTask?.result?.files?.[0]?.url;
  if (!fileUrl) throw new Error("CloudConvert không trả về file PDF kết quả");

  const pdfRes = await fetch(fileUrl);
  if (!pdfRes.ok) throw new Error(`Tải PDF kết quả từ CloudConvert thất bại: ${pdfRes.status}`);
  return Buffer.from(await pdfRes.arrayBuffer());
}
