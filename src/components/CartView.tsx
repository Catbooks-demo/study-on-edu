"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { discountPct, won } from "@/lib/format";
import { CourseThumb } from "./CourseThumb";

export type CartLineView = {
  key: string;
  kind: "course" | "bundle";
  title: string;
  category: string;
  instructor_name: string | null;
  list: number;
  unit: number;
  on_sale: boolean;
};

/** 장바구니: 줄 빼기, 합계, 주문하기 (주문서로). */
export function CartView({ lines, listTotal, discountTotal, payable }: { lines: CartLineView[]; listTotal: number; discountTotal: number; payable: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove(l: CartLineView) {
    setError(null);
    try {
      await api("/api/cart", l.kind === "course" ? { course_code: l.key } : { bundle_code: l.key }, "DELETE");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function order() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ order: { code: string } }>("/api/orders", {});
      router.push(`/checkout/${r.order.code}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  if (!lines.length) {
    return (
      <div className="rounded-2xl bg-white p-10 text-center ring-1 ring-slate-200">
        <p className="font-semibold">장바구니가 비어 있어요.</p>
        <Link href="/courses" className="btn-primary mt-4">강의 둘러보기</Link>
      </div>
    );
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <ul className="space-y-3" aria-label="담은 강의">
        {lines.map((l) => (
          <li key={l.key} data-testid="cart-line" className="flex gap-4 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <CourseThumb code={l.key} category={l.category === "PKG" ? "DEV" : l.category} className="w-28 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-brand-600">{l.kind === "bundle" ? "패키지" : l.instructor_name}</p>
              <Link href={l.kind === "bundle" ? `/bundles/${l.key}` : `/courses/${l.key}`} className="line-clamp-2 font-semibold hover:text-brand-700">{l.title}</Link>
              <div className="mt-1 flex items-baseline gap-2 text-sm">
                {l.on_sale && <span className="font-bold text-rose-500">{discountPct(l.list, l.unit)}%</span>}
                <span className="price">{won(l.unit)}</span>
                {l.on_sale && <span className="text-slate-400 line-through">{won(l.list)}</span>}
              </div>
            </div>
            <button type="button" onClick={() => remove(l)} className="self-start text-sm text-slate-500 underline" aria-label={`${l.title} 빼기`}>빼기</button>
          </li>
        ))}
      </ul>
      <aside className="h-fit rounded-2xl bg-white p-5 ring-1 ring-slate-200">
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between"><dt className="text-slate-500">정가 합계</dt><dd>{won(listTotal)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">할인</dt><dd className="text-rose-500">−{won(discountTotal)}</dd></div>
          <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-bold"><dt>결제 예정</dt><dd className="price">{won(payable)}</dd></div>
        </dl>
        <p className="mt-2 text-xs text-slate-500">쿠폰은 다음 주문서에서 넣을 수 있어요.</p>
        {error && <p className="mt-2 text-sm text-rose-600" role="alert">{error}</p>}
        <button type="button" onClick={order} disabled={busy} className="btn-primary mt-4 w-full py-3">{busy ? "주문서를 만드는 중…" : "주문하기"}</button>
      </aside>
    </div>
  );
}
