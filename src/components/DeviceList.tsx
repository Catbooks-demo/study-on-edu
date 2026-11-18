"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { dateTimeKo } from "@/lib/format";

export type DeviceRow = { id: string; name: string; first_seen_at: string; last_seen_at: string; current: boolean };

/** 등록 기기 목록과 해제 버튼. */
export function DeviceList({ devices }: { devices: DeviceRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function revoke(d: DeviceRow) {
    if (!window.confirm(`${d.name} 기기를 해제할까요? 그 기기에서 재생 중이면 멈춰요.`)) return;
    setBusy(d.id);
    setError(null);
    try {
      await api(`/api/devices/${d.id}`, undefined, "DELETE");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!devices.length) {
    return <p className="mt-4 rounded-2xl bg-white p-8 text-center text-sm text-slate-600 ring-1 ring-slate-200">등록된 기기가 없어요. 강의를 재생하면 그 기기가 등록돼요.</p>;
  }
  return (
    <>
      <ul className="mt-4 divide-y divide-slate-100 rounded-2xl bg-white ring-1 ring-slate-200">
        {devices.map((d) => (
          <li key={d.id} data-testid="device-row" className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <p className="font-semibold">
                {d.name}
                {d.current && <span className="badge ml-2 bg-brand-50 text-brand-700 ring-brand-200">지금 이 기기</span>}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                처음 사용 {dateTimeKo(d.first_seen_at)} · 마지막 사용 {dateTimeKo(d.last_seen_at)}
              </p>
            </div>
            <button type="button" onClick={() => revoke(d)} disabled={busy === d.id} className="btn-line px-3 py-1.5 text-sm">
              {busy === d.id ? "해제하는 중…" : "해제"}
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
    </>
  );
}
