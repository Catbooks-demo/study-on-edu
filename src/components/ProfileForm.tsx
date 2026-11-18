"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";

const INTERESTS = [
  ["DEV", "개발·프로그래밍"],
  ["DATA", "데이터·AI"],
  ["CERT", "자격증"],
  ["LANG", "어학"],
  ["DSGN", "디자인"],
  ["BIZ", "비즈니스·마케팅"],
  ["EXAM", "수능·내신"],
] as const;

type P = { name: string; phone: string; birth_year: number | null; interests: string[]; marketing_opt_in: boolean };

/** 회원 정보 고치기 (이메일은 바꿀 수 없다). */
export function ProfileForm({ initial, email }: { initial: P; email: string }) {
  const router = useRouter();
  const [f, setF] = useState({ ...initial, birth_year: initial.birth_year ? String(initial.birth_year) : "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/me", { ...f, birth_year: f.birth_year ? Number(f.birth_year) : null }, "PATCH");
      setMsg({ ok: true, text: "회원 정보를 저장했어요." });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }
  const toggle = (code: string) =>
    setF({ ...f, interests: f.interests.includes(code) ? f.interests.filter((x) => x !== code) : [...f.interests, code] });
  return (
    <form onSubmit={submit} className="mt-6 space-y-4 rounded-2xl bg-white p-6 ring-1 ring-slate-200">
      <div><span className="label">이메일</span><p className="text-sm text-slate-600">{email}</p></div>
      <div><label htmlFor="pf-name" className="label">이름</label><input id="pf-name" required maxLength={30} className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div><label htmlFor="pf-phone" className="label">휴대폰</label><input id="pf-phone" required inputMode="tel" className="field" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
      <div><label htmlFor="pf-birth" className="label">태어난 해 (선택)</label><input id="pf-birth" inputMode="numeric" maxLength={4} className="field" value={f.birth_year} onChange={(e) => setF({ ...f, birth_year: e.target.value.replace(/[^0-9]/g, "") })} /></div>
      <fieldset>
        <legend className="label">관심 분야</legend>
        <div className="flex flex-wrap gap-2">
          {INTERESTS.map(([code, label]) => (
            <button key={code} type="button" aria-pressed={f.interests.includes(code)} onClick={() => toggle(code)} className={`rounded-full px-3 py-1 text-sm ring-1 ${f.interests.includes(code) ? "bg-brand-500 text-white ring-brand-500" : "bg-white text-slate-700 ring-slate-200"}`}>{label}</button>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-brand-500" checked={f.marketing_opt_in} onChange={(e) => setF({ ...f, marketing_opt_in: e.target.checked })} />할인·기획전 소식을 받을게요.</label>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm ${msg.ok ? "text-brand-700" : "text-red-600"}`}>{msg.text}</p>}
      <button disabled={busy} className="btn-primary px-4 py-2">{busy ? "저장하는 중…" : "저장"}</button>
    </form>
  );
}
