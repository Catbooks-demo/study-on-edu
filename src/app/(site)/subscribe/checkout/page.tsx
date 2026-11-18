import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { SubscribeForm } from "@/components/SubscribeForm";
import { SUBSCRIPTION_REFUND_RULES } from "@/lib/refund-terms";
import { won } from "@/lib/format";
import { currentUser } from "@/server/auth/current";
import { db } from "@/server/db";
import { tossEnabled } from "@/server/env";
import { ALIVE } from "@/server/subscriptions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "구독 신청" };

export default async function SubscribeCheckoutPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { plan: planCode = "monthly" } = await searchParams;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/subscribe/checkout?plan=${planCode}`)}`);
  const plan = await db.plan.findUnique({ where: { code: planCode } });
  if (!plan || !plan.active) notFound();
  const alive = await db.subscription.findFirst({ where: { user_id: user.id, status: { in: ALIVE } } });
  const yearly = plan.interval === "year";
  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <p className="text-sm"><Link href="/subscribe" className="text-brand-600 hover:underline">전체 이용 구독</Link></p>
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight">구독 신청</h1>
      <div className="mt-6 rounded-2xl bg-white p-6 ring-1 ring-slate-200">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-bold">{plan.name}</h2>
          <p><span className="price text-2xl">{won(plan.price)}</span><span className="text-sm text-slate-500"> / {yearly ? "년" : "월"}</span></p>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          결제한 때부터 {yearly ? "1년" : "1달"} 동안 구독 대상 강의를 모두 들을 수 있어요. 일시정지는 1년에 2번, 한 번에 30일까지 할 수 있어요.
        </p>
        <div className="mt-6">
          {alive ? (
            <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-700">
              이미 구독 중이에요. <Link href="/my/subscription" className="font-semibold underline">구독 관리로 가기</Link>
            </p>
          ) : (
            <SubscribeForm planCode={plan.code} price={plan.price} toss={tossEnabled()} />
          )}
        </div>
      </div>
      <section className="mt-6 rounded-2xl bg-white p-6 ring-1 ring-slate-200">
        <h2 className="font-bold">구독 환불</h2>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-6 text-slate-700">
          {SUBSCRIPTION_REFUND_RULES.map((r) => <li key={r}>{r}</li>)}
        </ul>
      </section>
    </div>
  );
}
