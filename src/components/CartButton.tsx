"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

/** 수강 신청: 장바구니에 담고 장바구니로 간다. 로그인하지 않았으면 로그인 뒤 이 화면으로 돌아온다. */
export function CartButton({ courseCode, bundleCode }: { courseCode?: string; bundleCode?: string }) {
  const router = useRouter();
  const path = usePathname();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(courseCode ? { course_code: courseCode } : { bundle_code: bundleCode }),
        credentials: "same-origin",
      });
      if (res.status === 401) {
        router.push(`/login?next=${encodeURIComponent(path)}`);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error?.message ?? "잠시 후 다시 시도해 주세요.");
      router.push("/cart");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={add} disabled={busy} className="btn-primary mt-5 w-full">
        {busy ? "담는 중…" : "수강 신청하기"}
      </button>
      {error && <p className="mt-2 text-center text-sm text-rose-600" role="alert">{error}</p>}
    </>
  );
}
