import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SubscriptionPanel } from "@/components/SubscriptionPanel";
import { INVOICE_STATUS_LABEL, SUBSCRIPTION_STATUS_LABEL, dateTimeKo, won } from "@/lib/format";
import { PAUSES_PER_YEAR } from "@/rules/billing";
import { currentUser } from "@/server/auth/current";
import { db } from "@/server/db";
import { currentSubscription, pausesOf } from "@/server/subscriptions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "구독 관리" };

const YEAR_MS = 365 * 86_400_000;

export default async function MySubscriptionPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/my/subscription");
  const s = await currentSubscription(user.id);
  const now = new Date();
  const refundOpen = s
    ? (await db.refund.count({ where: { invoice: { subscription_id: s.id }, status: { in: ["requested", "approved"] } } })) > 0
    : false;
  const recentPauses = s ? pausesOf(s).filter((p) => p.start.getTime() > now.getTime() - YEAR_MS).length : 0;
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-sm"><Link href="/my" className="text-brand-600 hover:underline">마이페이지</Link></p>
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight">구독 관리</h1>
      {!s ? (
        <div className="mt-6 rounded-2xl bg-white p-8 text-center text-sm text-slate-600 ring-1 ring-slate-200">
          구독하고 있지 않아요. <Link href="/subscribe" className="font-semibold text-brand-600 underline">전체 이용 구독 보기</Link>
        </div>
      ) : (
        <>
          <section className="mt-6 rounded-2xl bg-white p-6 ring-1 ring-slate-200" data-testid="subscription-summary">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold">{s.plan.name}</h2>
              <span className="badge">{SUBSCRIPTION_STATUS_LABEL[s.status] ?? s.status}</span>
            </div>
            <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
              <dt className="text-slate-500">이번 기간</dt>
              <dd>{dateTimeKo(s.current_period_start.toISOString())} ~ {dateTimeKo(s.current_period_end.toISOString())}</dd>
              <dt className="text-slate-500">결제 금액</dt>
              <dd className="price">{won(s.plan.price)}</dd>
              <dt className="text-slate-500">결제 카드</dt>
              <dd className="font-mono">{s.card_label} ····{s.card_last4}</dd>
              {s.status === "active" && !s.cancel_at_period_end && (
                <>
                  <dt className="text-slate-500">다음 결제</dt>
                  <dd>{dateTimeKo(new Date(s.current_period_end.getTime() - 86_400_000).toISOString())}쯤 자동 결제</dd>
                </>
              )}
              {s.status === "past_due" && s.next_retry_at && (
                <>
                  <dt className="text-slate-500">다시 결제</dt>
                  <dd className="text-rose-700">결제가 {s.failure_count}번 실패했어요. {dateTimeKo(s.next_retry_at.toISOString())}에 다시 결제해요.</dd>
                </>
              )}
              {s.status === "paused" && s.paused_until && (
                <>
                  <dt className="text-slate-500">일시정지</dt>
                  <dd>{dateTimeKo(s.paused_until.toISOString())}에 다시 시작해요.</dd>
                </>
              )}
              {s.cancel_at_period_end && (
                <>
                  <dt className="text-slate-500">해지 예약</dt>
                  <dd>{dateTimeKo(s.current_period_end.toISOString())}에 끝나요.</dd>
                </>
              )}
            </dl>
            {!["active", "past_due", "paused"].includes(s.status) && (
              <Link href="/subscribe" className="btn-primary mt-5">다시 구독하기</Link>
            )}
          </section>

          <div className="mt-6">
            <SubscriptionPanel
              id={s.id}
              status={s.status}
              cancelAtPeriodEnd={s.cancel_at_period_end}
              pausesLeft={Math.max(0, PAUSES_PER_YEAR - recentPauses)}
              refundOpen={refundOpen}
            />
          </div>

          <section className="mt-6 rounded-2xl bg-white p-6 ring-1 ring-slate-200">
            <h2 className="font-bold">결제 내역</h2>
            <ul className="mt-3 divide-y divide-slate-100 text-sm">
              {s.invoices.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>{dateTimeKo(i.period_start.toISOString())} ~ {dateTimeKo(i.period_end.toISOString())}</span>
                  <span className="price">{won(i.amount)}</span>
                  <span className="badge">{INVOICE_STATUS_LABEL[i.status] ?? i.status}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
