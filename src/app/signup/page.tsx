"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { AuthCard } from "@/components/AuthCard";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });

    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setDone(true);
  }

  if (done) {
    return (
      <AuthCard title="Kiểm tra email của bạn">
        <p className="text-center text-sm text-slate-600">Kiểm tra email để xác nhận tài khoản, sau đó đăng nhập.</p>
        <Link href="/login" className="btn-primary w-full">
          Về trang đăng nhập
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Đăng ký giáo viên">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="field-label">Họ tên</label>
          <input required value={fullName} onChange={(e) => setFullName(e.target.value)} className="input-field" />
        </div>

        <div>
          <label className="field-label">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input-field"
          />
        </div>

        <div>
          <label className="field-label">Mật khẩu</label>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input-field"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Đang tạo..." : "Đăng ký"}
        </button>

        <p className="text-center text-sm text-slate-600">
          Đã có tài khoản?{" "}
          <Link href="/login" className="font-medium text-indigo-600 hover:underline">
            Đăng nhập
          </Link>
        </p>
      </form>
    </AuthCard>
  );
}
