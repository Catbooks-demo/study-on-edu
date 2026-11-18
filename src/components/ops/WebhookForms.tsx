"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

const EVENTS = [
  ["order.paid", "주문 결제"],
  ["order.refunded", "주문 환불 완료"],
  ["subscription.status_changed", "구독 상태 바뀜"],
  ["service_mode.changed", "서비스 모드 바뀜"],
  ["incident.created", "장애 공지 올림"],
  ["incident.updated", "장애 공지 바뀜"],
] as const;

/** 웹훅 주소 등록. secret 원문은 등록 직후 한 번만 보여 준다. */
export function NewWebhookForm() {
  const router = useRouter();
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setError(null);
    try {
      const r = await api<{ secret: string }>("/api/admin/webhooks", { url: f.get("url"), events: f.getAll("events") });
      setSecret(r.secret);
      (e.target as HTMLFormElement).reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl bg-white p-5 ring-1 ring-slate-200">
      <h2 className="font-semibold">주소 등록</h2>
      <label className="label" htmlFor="wh-url">받을 주소 (https)</label>
      <input id="wh-url" name="url" type="url" required placeholder="https://<받는 서버>/hooks/studyon" className="field" />
      <fieldset className="grid gap-1.5 text-sm">
        <legend className="label">이벤트</legend>
        {EVENTS.map(([v, l]) => (
          <label key={v} className="flex items-center gap-2">
            <input type="checkbox" name="events" value={v} defaultChecked /> {l} <code className="text-xs text-slate-500">{v}</code>
          </label>
        ))}
      </fieldset>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <button className="btn-primary">등록</button>
      {secret && (
        <div className="rounded-lg bg-lemon-50 p-3 text-sm ring-1 ring-lemon-300" role="status">
          <p className="font-semibold">서명 비밀값이에요. 지금 한 번만 보여요. 받는 쪽에 저장해 주세요.</p>
          <code className="mt-1 block break-all">{secret}</code>
        </div>
      )}
    </form>
  );
}

/** 주소 하나: 켜기·끄기, 시험 보내기, 지우기. */
export function WebhookActions({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>, done?: (r: unknown) => string) {
    setMsg(null);
    try {
      const r = await fn();
      if (done) setMsg(done(r));
      router.refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      <button type="button" className="btn-line" onClick={() => run(() => api(`/api/admin/webhooks/${id}`, { active: !active }, "PATCH"))}>
        {active ? "끄기" : "켜기"}
      </button>
      <button
        type="button"
        className="btn-line"
        onClick={() =>
          run(
            () => api<{ status: string; last_status: number | null }>(`/api/admin/webhooks/${id}/test`, {}),
            (r) => {
              const v = r as { status: string; last_status: number | null };
              return v.status === "done" ? `받았어요 (HTTP ${v.last_status})` : `보내지 못했어요 (${v.last_status ?? "응답 없음"}). 1분 뒤 다시 보내요.`;
            },
          )
        }
      >
        시험 보내기
      </button>
      <button
        type="button"
        className="text-rose-600 underline"
        onClick={() => {
          if (confirm("이 주소를 지울까요? 배달 기록도 같이 지워져요.")) run(() => api(`/api/admin/webhooks/${id}`, undefined, "DELETE"));
        }}
      >
        지우기
      </button>
      {msg && <span role="status" className="text-slate-600">{msg}</span>}
    </div>
  );
}
