import Link from "next/link";
import { ConfirmSubmit } from "./ConfirmSubmit";

/** 직원 화면 공통 조각. 서버 컴포넌트에서 쓴다. */

/** 처리 결과 알림 (?ok= / ?err=). */
export function Flash({ sp }: { sp: { ok?: string; err?: string } }) {
  if (sp.err) return <p className="mb-4 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 ring-1 ring-rose-200" role="alert">{sp.err}</p>;
  if (sp.ok) return <p className="mb-4 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800 ring-1 ring-emerald-200" role="status">{sp.ok}</p>;
  return null;
}

export function PageTitle({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-slate-500">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

export function Table({ head, children, empty, emptyText = "아직 없어요." }: { head: string[]; children: React.ReactNode; empty?: boolean; emptyText?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>{head.map((h, i) => <th key={`${h}-${i}`} className="whitespace-nowrap px-3 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
      {empty && <p className="p-6 text-center text-sm text-slate-500">{emptyText}</p>}
    </div>
  );
}

export const Td = ({ children, className = "" }: { children?: React.ReactNode; className?: string }) => (
  <td className={`whitespace-nowrap px-3 py-2 align-top ${className}`}>{children}</td>
);

export function Pager({ page, pages, href }: { page: number; pages: number; href: (p: number) => string }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="페이지" className="mt-4 flex items-center gap-1">
      {page > 1 && <Link href={href(page - 1)} className="rounded px-3 py-1 text-sm hover:bg-slate-200">이전</Link>}
      <span className="px-3 py-1 text-sm text-slate-500">{page} / {pages}</span>
      {page < pages && <Link href={href(page + 1)} className="rounded px-3 py-1 text-sm hover:bg-slate-200">다음</Link>}
    </nav>
  );
}

export const Card = ({ children, className = "", title, action }: { children: React.ReactNode; className?: string; title?: string; action?: React.ReactNode }) => (
  <section className={`rounded-xl border border-slate-200 bg-white p-4 ${className}`}>
    {(title || action) && (
      <div className="mb-3 flex items-center justify-between gap-2">
        {title && <h2 className="font-bold">{title}</h2>}
        {action}
      </div>
    )}
    {children}
  </section>
);

type Tone = "gray" | "green" | "amber" | "red" | "brand" | "blue";
const TONE: Record<Tone, string> = {
  gray: "bg-slate-100 text-slate-700 ring-slate-300",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-300",
  amber: "bg-amber-50 text-amber-800 ring-amber-300",
  red: "bg-rose-50 text-rose-700 ring-rose-300",
  brand: "bg-brand-50 text-brand-700 ring-brand-200",
  blue: "bg-sky-50 text-sky-700 ring-sky-300",
};

export function Pill({ tone = "gray", children, testId }: { tone?: Tone; children: React.ReactNode; testId?: string }) {
  return <span data-testid={testId} className={`badge whitespace-nowrap ${TONE[tone]}`}>{children}</span>;
}

/** 상태 코드 → 색. */
export function toneOf(status: string): Tone {
  if (["published", "paid", "active", "done", "answered", "confirmed", "live", "approved_done"].includes(status)) return "green";
  if (["in_review", "requested", "pending", "past_due", "approved", "open", "draft", "scheduled", "partially_refunded"].includes(status)) return "amber";
  if (["rejected", "failed", "expired", "cancelled", "refunded", "suspended", "hidden"].includes(status)) return "red";
  if (["paused"].includes(status)) return "blue";
  return "gray";
}

/** 숫자 타일 (대시보드). */
export function Stat({ label, value, href, warn, hint }: { label: string; value: string; href?: string; warn?: boolean; hint?: string }) {
  const body = (
    <>
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
    </>
  );
  const cls = `block rounded-xl border bg-white p-4 ${warn ? "border-amber-400 ring-1 ring-amber-200" : "border-slate-200"} ${href ? "hover:border-brand-300" : ""}`;
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** 검색·필터 줄 (GET 폼). */
export function Filters({ children, action }: { children: React.ReactNode; action?: string }) {
  return (
    <form method="get" action={action} className="mb-4 flex flex-wrap items-end gap-2 rounded-xl border border-slate-200 bg-white p-3 text-sm">
      {children}
      <button className="btn-line px-3 py-2">찾기</button>
    </form>
  );
}

/** 탭처럼 쓰는 링크 줄. */
export function Tabs({ items, current }: { items: { href: string; label: string; key: string }[]; current: string }) {
  return (
    <nav aria-label="상태" className="mb-4 flex flex-wrap gap-1 text-sm">
      {items.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === current ? "page" : undefined}
          className={`rounded-full px-3 py-1 ${t.key === current ? "bg-ink text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-brand-300"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/** 정의 목록 (상세 화면). */
export function Dl({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-slate-500">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** 작은 막대 그래프 (서버에서 그리는 SVG). */
export function MiniBars({ data, label, format }: { data: { key: string; value: number; title: string }[]; label: string; format: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 12;
  const gap = 4;
  const h = 56;
  return (
    <figure>
      <svg role="img" aria-label={label} viewBox={`0 0 ${data.length * (w + gap)} ${h}`} className="h-16 w-full" preserveAspectRatio="none">
        {data.map((d, i) => {
          const bh = d.value > 0 ? Math.max(2, (d.value / max) * (h - 2)) : 0;
          return (
            <rect key={d.key} x={i * (w + gap)} y={h - bh} width={w} height={bh} rx={2} className={i === data.length - 1 ? "fill-brand-500" : "fill-brand-200"}>
              <title>{`${d.title} · ${format(d.value)}`}</title>
            </rect>
          );
        })}
      </svg>
    </figure>
  );
}

export function Empty({ children = "없어요." }: { children?: React.ReactNode }) {
  return <p className="py-3 text-sm text-slate-400">{children}</p>;
}

/** 숨은 값과 함께 보내는 작은 폼 버튼 (서버 액션). */
export function ActionButton({
  action, fields, label, tone = "line", confirm,
}: {
  action: (f: FormData) => Promise<void>;
  fields: Record<string, string>;
  label: string;
  tone?: "line" | "primary" | "danger";
  confirm?: string;
}) {
  const cls = tone === "primary" ? "btn-primary px-3 py-1.5" : tone === "danger" ? "btn border border-rose-300 bg-white px-3 py-1.5 text-rose-700 hover:bg-rose-50" : "btn-line px-3 py-1.5";
  return (
    <form action={action} className="inline">
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {confirm ? <ConfirmSubmit className={cls} label={label} message={confirm} /> : <button className={cls}>{label}</button>}
    </form>
  );
}

export { ConfirmSubmit };
