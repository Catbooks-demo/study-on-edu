import type { Metadata } from "next";
import Link from "next/link";
import { SUBSCRIPTION_REFUND_RULES } from "@/lib/refund-terms";
import { won } from "@/lib/format";
import { subscriptionInfo } from "@/server/catalog";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "전체 이용 구독" };

/** 구독 소개. 플랜을 고르면 /subscribe/checkout에서 신청·결제한다. */
export default async function SubscribePage() {
  const { plans, courseCount, publishedCount } = await subscriptionInfo();
  const monthly = plans.find((p) => p.code === "monthly");
  return (
    <div>
      <section className="bg-ink text-white">
        <div className="mx-auto max-w-6xl px-4 py-14 text-center">
          <p className="text-sm font-semibold text-lemon-400">전체 이용 구독</p>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-4xl">강의 {courseCount}개, 하나의 구독으로</h1>
          <p className="mx-auto mt-3 max-w-xl text-white/75">
            공개 강의 {publishedCount}개 중 {courseCount}개가 구독에 들어 있어요. 구독하는 동안 마음껏 듣고, 해지해도 진도는 남아요.
          </p>
        </div>
      </section>
      <div className="mx-auto max-w-4xl px-4 py-10">
        <ul className="grid gap-5 sm:grid-cols-2">
          {plans.map((p) => {
            const yearly = p.interval === "year";
            const saving = yearly && monthly ? monthly.price * 12 - p.price : 0;
            return (
              <li key={p.code} className={`relative rounded-3xl bg-white p-6 ring-1 ${yearly ? "ring-2 ring-brand-500" : "ring-slate-200"}`}>
                {yearly && saving > 0 && (
                  <span className="absolute -top-3 left-6 rounded-full bg-lemon-500 px-3 py-1 text-xs font-bold text-ink">월 구독보다 {won(saving)} 아껴요</span>
                )}
                <h2 className="text-lg font-bold">{p.name}</h2>
                <p className="mt-2"><span className="price text-3xl">{won(p.price)}</span><span className="text-sm text-slate-500"> / {yearly ? "년" : "월"}</span></p>
                <ul className="mt-4 space-y-1.5 text-sm text-slate-700">
                  <li>✓ 구독 대상 강의 전부 수강</li>
                  <li>✓ 기간이 끝나기 하루 전 자동 결제</li>
                  <li>✓ 해지 예약·일시정지(1년 2번, 최대 30일)</li>
                </ul>
                <Link href={`/subscribe/checkout?plan=${p.code}`} className="btn-primary mt-6 w-full">{p.name} 시작하기</Link>
              </li>
            );
          })}
        </ul>
        <div className="mt-6 text-center">
          <Link href="/courses?sub=1" className="btn-line">구독 포함 강의 보기</Link>
        </div>
        <section className="mt-12 rounded-2xl bg-white p-6 ring-1 ring-slate-200">
          <h2 className="text-lg font-bold">구독 환불</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
            {SUBSCRIPTION_REFUND_RULES.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </section>
      </div>
    </div>
  );
}
