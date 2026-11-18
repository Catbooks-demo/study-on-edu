"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { safeNext } from "@/lib/nav";

function useSubmit() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }
  return { error, busy, run };
}

const INTERESTS = [
  ["DEV", "개발·프로그래밍"],
  ["DATA", "데이터·AI"],
  ["CERT", "자격증"],
  ["LANG", "어학"],
  ["DSGN", "디자인"],
  ["BIZ", "비즈니스·마케팅"],
  ["EXAM", "수능·내신"],
] as const;

/** 이메일·비밀번호 로그인 (회원·직원·강사 공용). */
function EmailLogin({ endpoint, onDone, idPrefix }: { endpoint: string; onDone: () => void; idPrefix: string }) {
  const [f, setF] = useState({ email: "", password: "" });
  const { error, busy, run } = useSubmit();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          await api(endpoint, f);
          onDone();
        });
      }}
      className="space-y-4"
    >
      <div><label htmlFor={`${idPrefix}-email`} className="label">이메일</label><input id={`${idPrefix}-email`} type="email" required autoComplete="username" className="field" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
      <div><label htmlFor={`${idPrefix}-password`} className="label">비밀번호</label><input id={`${idPrefix}-password`} type="password" required autoComplete="current-password" className="field" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
      {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
      <button disabled={busy} className="btn-primary w-full py-3">{busy ? "확인하는 중…" : "로그인"}</button>
    </form>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  return (
    <div className="space-y-4">
      <EmailLogin
        endpoint="/api/auth/login"
        idPrefix="login"
        onDone={() => {
          router.push(safeNext(next));
          router.refresh();
        }}
      />
      <p className="text-center text-sm text-slate-600">처음이신가요? <Link href="/signup" className="font-semibold text-brand-600 underline">회원가입</Link></p>
    </div>
  );
}

/** 직원·강사 로그인. 돌아갈 곳은 그 영역 안 경로만. */
export function AreaLoginForm({ area, next }: { area: "admin" | "instructor"; next?: string }) {
  const router = useRouter();
  const home = `/${area}`;
  return (
    <EmailLogin
      endpoint={`/api/${area}/auth/login`}
      idPrefix={area}
      onDone={() => {
        const to = safeNext(next, home);
        router.push(to === home || to.startsWith(`${home}/`) || to.startsWith(`${home}?`) ? to : home);
        router.refresh();
      }}
    />
  );
}

export function SignupForm() {
  const router = useRouter();
  const [f, setF] = useState({
    email: "", password: "", name: "", phone: "", birth_year: "",
    interests: [] as string[], marketing_opt_in: false, agree_terms: false, agree_privacy: false,
  });
  const { error, busy, run } = useSubmit();
  const toggle = (code: string) =>
    setF({ ...f, interests: f.interests.includes(code) ? f.interests.filter((c) => c !== code) : [...f.interests, code] });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          await api("/api/auth/signup", { ...f, birth_year: f.birth_year ? Number(f.birth_year) : null });
          router.push("/");
          router.refresh();
        });
      }}
      className="space-y-4"
    >
      <div><label htmlFor="name" className="label">이름</label><input id="name" required autoComplete="name" className="field" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div><label htmlFor="email" className="label">이메일</label><input id="email" type="email" required autoComplete="email" className="field" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
      <div><label htmlFor="password" className="label">비밀번호 (8자 이상)</label><input id="password" type="password" required minLength={8} autoComplete="new-password" className="field" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
      <div><label htmlFor="phone" className="label">휴대폰</label><input id="phone" required inputMode="tel" autoComplete="tel" placeholder="010-1234-5678" className="field" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
      <div><label htmlFor="birth_year" className="label">태어난 해 (선택)</label><input id="birth_year" inputMode="numeric" maxLength={4} placeholder="2003" className="field" value={f.birth_year} onChange={(e) => setF({ ...f, birth_year: e.target.value.replace(/[^0-9]/g, "") })} /></div>
      <fieldset>
        <legend className="label">관심 분야 (선택)</legend>
        <div className="flex flex-wrap gap-2">
          {INTERESTS.map(([code, name]) => (
            <button
              type="button"
              key={code}
              aria-pressed={f.interests.includes(code)}
              onClick={() => toggle(code)}
              className={`rounded-full border px-3 py-1 text-sm ${f.interests.includes(code) ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-300 bg-white text-slate-600"}`}
            >
              {name}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="space-y-2 rounded-xl bg-slate-50 p-4 text-sm">
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-500" checked={f.agree_terms} onChange={(e) => setF({ ...f, agree_terms: e.target.checked })} />[필수] <Link href="/terms/service" target="_blank" className="underline">이용약관</Link>에 동의해요.</label>
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-500" checked={f.agree_privacy} onChange={(e) => setF({ ...f, agree_privacy: e.target.checked })} />[필수] <Link href="/terms/privacy" target="_blank" className="underline">개인정보 수집·이용</Link>에 동의해요.</label>
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-brand-500" checked={f.marketing_opt_in} onChange={(e) => setF({ ...f, marketing_opt_in: e.target.checked })} />[선택] 할인·기획전 소식을 받을게요.</label>
      </div>
      {error && <p className="text-sm text-rose-600" role="alert">{error}</p>}
      <button disabled={busy} className="btn-primary w-full py-3">{busy ? "가입하는 중…" : "가입하기"}</button>
    </form>
  );
}

export function LogoutButton({ area = "site" }: { area?: "site" | "admin" | "instructor" }) {
  const router = useRouter();
  const endpoint = area === "site" ? "/api/auth/logout" : `/api/${area}/auth/logout`;
  const to = area === "site" ? "/" : `/${area}/login`;
  return (
    <button
      onClick={async () => {
        await api(endpoint, {});
        router.push(to);
        router.refresh();
      }}
      className="text-sm text-slate-500 underline"
    >
      로그아웃
    </button>
  );
}
