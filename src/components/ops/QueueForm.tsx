"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

/** 대기열 하나 켜기·끄기·한도 바꾸기. target을 비워 두면 새 대상을 적는다. */
export function QueueForm(props: { target?: string; enabled?: boolean; rate?: number; courseCodes?: string[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isNew = !props.target;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const target = String(f.get("target") ?? props.target ?? "").trim();
    const codes = String(f.get("course_codes") ?? "")
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/ops/queue", {
        target,
        enabled: f.get("enabled") === "on",
        rate_per_sec: Number(f.get("rate_per_sec")),
        ...(target.startsWith("checkout:") ? { course_codes: codes } : {}),
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 text-sm">
      {isNew ? (
        <label className="flex flex-col gap-1">
          <span className="label">대상</span>
          <input name="target" required placeholder="site · checkout:d30 · live:<id>" className="field w-56" />
        </label>
      ) : null}
      <label className="flex items-center gap-2">
        <input type="checkbox" name="enabled" defaultChecked={props.enabled ?? true} /> 켜기
      </label>
      <label className="flex flex-col gap-1">
        <span className="label">초당 입장</span>
        <input name="rate_per_sec" type="number" min={1} required defaultValue={props.rate ?? 50} className="field w-24" />
      </label>
      {(isNew || props.target?.startsWith("checkout:")) && (
        <label className="flex flex-col gap-1">
          <span className="label">대상 강의 코드 (비우면 모든 주문)</span>
          <input name="course_codes" defaultValue={props.courseCodes?.join(", ") ?? ""} className="field w-72" />
        </label>
      )}
      <button className="btn-primary" disabled={busy}>{busy ? "저장 중…" : "저장"}</button>
      {error && <p role="alert" className="w-full text-rose-600">{error}</p>}
    </form>
  );
}
