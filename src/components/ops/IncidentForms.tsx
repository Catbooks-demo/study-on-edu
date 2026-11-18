"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

const COMPONENTS = [
  ["web", "웹사이트"],
  ["player", "강의 재생"],
  ["payments", "결제"],
  ["live", "라이브"],
  ["api", "외부 API"],
] as const;

const STATUSES = [
  ["investigating", "원인 찾는 중"],
  ["identified", "원인 찾음"],
  ["monitoring", "지켜보는 중"],
  ["resolved", "해결"],
] as const;

/** 새 장애 공지. */
export function NewIncidentForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api("/api/admin/ops/incidents", {
        title: f.get("title"),
        body: f.get("body"),
        severity: f.get("severity"),
        components: f.getAll("components"),
      });
      (e.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl bg-white p-5 ring-1 ring-slate-200">
      <h2 className="font-semibold">새 장애 공지</h2>
      <label className="label" htmlFor="inc-title">제목</label>
      <input id="inc-title" name="title" required maxLength={100} className="field" />
      <label className="label" htmlFor="inc-body">안내 문구</label>
      <textarea id="inc-body" name="body" required maxLength={2000} rows={3} className="field" />
      <fieldset className="flex flex-wrap gap-3 text-sm">
        <legend className="label">영향 받는 곳</legend>
        {COMPONENTS.map(([v, l]) => (
          <label key={v} className="flex items-center gap-1.5"><input type="checkbox" name="components" value={v} /> {l}</label>
        ))}
      </fieldset>
      <label className="label" htmlFor="inc-sev">정도</label>
      <select id="inc-sev" name="severity" className="field" defaultValue="degraded">
        <option value="degraded">느려요 (degraded)</option>
        <option value="outage">장애 (outage)</option>
      </select>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <button className="btn-primary" disabled={busy}>{busy ? "올리는 중…" : "공지 올리기"}</button>
    </form>
  );
}

/** 장애 공지 상태 바꾸기. */
export function IncidentStatusForm({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    try {
      const body = String(f.get("body") ?? "").trim();
      await api(`/api/admin/ops/incidents/${id}`, { status: f.get("status"), ...(body ? { body } : {}) }, "PATCH");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2 text-sm">
      <select name="status" defaultValue={status} className="field w-auto" aria-label="상태">
        {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <input name="body" placeholder="새 안내 문구 (비우면 그대로)" maxLength={2000} className="field min-w-64 flex-1" aria-label="새 안내 문구" />
      <button className="btn-line">바꾸기</button>
      {error && <p role="alert" className="w-full text-rose-600">{error}</p>}
    </form>
  );
}
