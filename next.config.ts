import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @napi-rs/canvas (native .node binary, dùng bởi emf-converter để OCR công thức WMF cũ)
  // bị Next.js bundle/tree-shake nhầm khi không khai báo external — kết quả quan sát thực
  // tế: hoạt động đúng trên Windows local nhưng convertMetafileToDataUrl() luôn trả về null
  // trên Vercel serverless (Linux) vì file .node không được copy vào bundle function. Khai
  // báo external để Next.js giữ nguyên package này thay vì cố gắng bundle nó.
  serverExternalPackages: ["@napi-rs/canvas", "emf-converter"],
};

export default nextConfig;
