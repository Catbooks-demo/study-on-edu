"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

/** 수료증 받기 (진도율 80% 이상). 받으면 수료증 화면으로 간다. */
export function CertificateButton({ courseCode }: { courseCode: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function issue() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ certificate: { number: string } }>("/api/certificates", { course_code: courseCode });
      router.push(`/certificates/${r.certificate.number}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" onClick={issue} disabled={busy} className="btn-accent px-3 py-1.5 text-sm">{busy ? "발급하는 중…" : "수료증 받기"}</button>
      {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
    </>
  );
}

/** 인쇄 버튼. */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="btn-primary px-4 py-2 print:hidden">인쇄하기</button>
  );
}
