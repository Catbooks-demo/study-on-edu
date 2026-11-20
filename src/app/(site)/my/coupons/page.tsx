import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { dateShort, won } from "@/lib/format";
import { currentUser } from "@/server/auth/current";
import { BOX_STATE_KO, myCoupons } from "@/server/couponbox";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "쿠폰함" };

const TARGET_KO: Record<string, string> = { all: "모든 강의", category: "분야", course: "강의", instructor: "강사" };

/** 쿠폰함: 받은 쿠폰과 쓸 수 있는지. */
export default async function CouponsPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/my/coupons");
  const list = await myCoupons(user.id);
  const usable = list.filter((c) => c.state === "usable").length;
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-sm"><Link href="/my" className="text-brand-600 hover:underline">마이페이지</Link></p>
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight">쿠폰함</h1>
      <p className="mt-1 text-sm text-slate-500">쓸 수 있는 쿠폰 {usable}장 · 주문서의 &lsquo;내 쿠폰&rsquo;에서 고르면 바로 적용돼요.</p>
      {list.length === 0 ? (
        <p className="mt-6 rounded-2xl bg-white p-8 text-center text-sm text-slate-600 ring-1 ring-slate-200">아직 받은 쿠폰이 없어요.</p>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {list.map((c) => (
            <li key={c.code} data-testid="box-coupon" className={`rounded-2xl bg-white p-5 ring-1 ring-slate-200 ${c.state === "usable" ? "" : "opacity-60"}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-lg font-extrabold text-brand-700">{c.discount}</p>
                <span className="badge shrink-0">{BOX_STATE_KO[c.state]}</span>
              </div>
              <p className="mt-1 font-semibold">{c.name}</p>
              <p className="mt-2 text-xs text-slate-500">
                {TARGET_KO[c.target] ?? c.target}{c.target_ref ? ` · ${c.target_ref}` : ""}
                {c.min_amount ? ` · ${won(c.min_amount)} 이상` : ""} · {dateShort(c.last_day)}까지
              </p>
              <p className="mt-1 font-mono text-xs text-slate-400">{c.code}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
