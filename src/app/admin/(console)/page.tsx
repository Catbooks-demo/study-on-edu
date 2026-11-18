import Link from "next/link";
import { Card, Empty, Flash, MiniBars, PageTitle, Pill, Stat } from "@/components/admin/ui";
import { dateKo, dateShort, dateTimeKo, won } from "@/lib/format";
import { questionOverdue } from "@/rules/deadlines";
import { kstDate } from "@/rules/time";
import { dashboardCounts, salesByDay } from "@/server/admin";
import { db } from "@/server/db";
import { activePlaybacks } from "@/server/player";
import { can } from "@/server/roles";
import { type SP, guard } from "./guard";

export const metadata = { title: "대시보드" };

export default async function Dashboard({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const st = await guard(null);
  const now = new Date();
  const today = kstDate(now);
  const [c, days, playing, refunds, queue, questions, inquiries, pastDue] = await Promise.all([
    dashboardCounts(now),
    salesByDay(now, 14),
    activePlaybacks(now),
    db.refund.findMany({ where: { status: "requested" }, include: { user: { select: { name: true } }, order_item: { include: { order: true, course: true, bundle: true } }, invoice: true }, orderBy: { created_at: "asc" }, take: 6 }),
    db.course.findMany({ where: { status: "in_review" }, include: { instructor: true }, orderBy: { updated_at: "asc" }, take: 6 }),
    db.question.findMany({ where: { answered_at: null }, include: { course: { select: { title: true } } }, orderBy: { created_at: "asc" }, take: 6 }),
    db.inquiry.findMany({ where: { status: "open" }, orderBy: { created_at: "asc" }, take: 6 }),
    db.subscription.findMany({ where: { status: "past_due" }, include: { user: { select: { id: true, name: true } } }, orderBy: { next_retry_at: "asc" }, take: 6 }),
  ]);
  const role = st.role;
  const tiles = [
    { label: "오늘 매출 (환불 뺀)", value: won(c.today_sales), href: can(role, "orders") ? "/admin/orders" : undefined },
    { label: "오늘 결제 주문", value: `${c.today_orders}건`, href: can(role, "orders") ? "/admin/orders" : undefined },
    { label: "환불 신청", value: `${c.refund_requests}건`, href: can(role, "refunds") ? "/admin/refunds?status=requested" : undefined, warn: c.refund_requests > 0 },
    { label: "처리 기한 넘긴 환불", value: `${c.overdue_refunds}건`, href: can(role, "refunds") ? "/admin/refunds?status=approved" : undefined, warn: c.overdue_refunds > 0, hint: "승인 뒤 5일" },
    { label: "오늘 새 구독", value: `${c.new_subscriptions}건`, href: can(role, "subscriptions") ? "/admin/subscriptions" : undefined },
    { label: "오늘 해지", value: `${c.cancellations}건`, href: can(role, "subscriptions") ? "/admin/subscriptions?status=cancelled" : undefined },
    { label: "오늘 결제 실패", value: `${c.payment_failures}건`, href: can(role, "subscriptions") ? "/admin/subscriptions?status=past_due" : undefined, warn: c.payment_failures > 0 },
    { label: "미답변 질문", value: `${c.unanswered_questions}건`, href: can(role, "support") ? "/admin/questions" : undefined, warn: c.unanswered_questions > 0 },
    { label: "답변 대기 문의", value: `${c.open_inquiries}건`, href: can(role, "support") ? "/admin/inquiries" : undefined, warn: c.open_inquiries > 0 },
    { label: "지금 재생 중", value: `${playing}명`, hint: "최근 60초 하트비트" },
  ];
  const total14 = days.reduce((a, d) => a + d.sales, 0);
  return (
    <>
      <PageTitle title="대시보드" sub={`${dateKo(today, true)} 한국 시간 기준이에요.`} />
      <Flash sp={sp} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((t) => <Stat key={t.label} {...t} />)}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <Card title="최근 14일 매출" className="lg:col-span-2" action={<span className="text-sm tabular-nums text-slate-500">합계 {won(total14)}</span>}>
          <MiniBars
            label="최근 14일 날짜별 매출"
            format={won}
            data={days.map((d) => ({ key: d.date, value: Math.max(0, d.sales), title: `${dateShort(d.date)} 주문 ${d.orders}건` }))}
          />
          <div className="mt-1 flex justify-between text-[11px] text-slate-400">
            <span>{dateShort(days[0].date)}</span>
            <span>오늘</span>
          </div>
        </Card>
        <Card title="운영 지표">
          <p className="text-sm text-slate-500">동시 재생·대기열·오류율 그래프 자리예요. 운영 지표가 켜지면 여기에 1분 단위로 그려져요.</p>
          <p className="mt-3 text-sm">지금 재생 중 <b className="tabular-nums">{playing}명</b></p>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {can(role, "refunds") && (
          <Card title="처리할 환불 신청" action={<Link href="/admin/refunds?status=requested" className="text-sm text-brand-600">전체</Link>}>
            {refunds.length === 0 ? <Empty /> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {refunds.map((r) => (
                  <li key={r.id}>
                    <Link href={`/admin/refunds/${r.id}`} className="flex justify-between gap-2 py-2 hover:text-brand-700">
                      <span className="truncate">{r.order_item ? `${r.order_item.order.code} · ${r.order_item.course?.title ?? r.order_item.bundle?.title}` : "구독 환불"} · {r.user.name}</span>
                      <span className="shrink-0 tabular-nums text-slate-500">{won(r.amount)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {can(role, "review_courses") && (
          <Card title="심사 기다리는 강의" action={<Link href="/admin/reviews-queue" className="text-sm text-brand-600">심사하기</Link>}>
            {queue.length === 0 ? <Empty /> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {queue.map((q) => (
                  <li key={q.id} className="flex justify-between gap-2 py-2">
                    <span className="truncate">{q.code} · {q.title}</span>
                    <span className="shrink-0 text-slate-500">{q.instructor.display_name}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {can(role, "support") && (
          <Card title="답을 기다리는 질문" action={<Link href="/admin/questions" className="text-sm text-brand-600">전체</Link>}>
            {questions.length === 0 ? <Empty /> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {questions.map((q) => (
                  <li key={q.id} className="flex justify-between gap-2 py-2">
                    <span className="truncate">{q.title} <span className="text-slate-400">· {q.course.title}</span></span>
                    {questionOverdue(q.created_at, q.answered_at, now) ? <Pill tone="red">7일 넘음</Pill> : <span className="shrink-0 text-slate-500">{dateTimeKo(q.created_at.toISOString())}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {can(role, "support") && (
          <Card title="답변 대기 문의" action={<Link href="/admin/inquiries" className="text-sm text-brand-600">전체</Link>}>
            {inquiries.length === 0 ? <Empty /> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {inquiries.map((q) => (
                  <li key={q.id}>
                    <Link href={`/admin/inquiries#${q.id}`} className="flex justify-between gap-2 py-2 hover:text-brand-700">
                      <span className="truncate">{q.title}</span>
                      <span className="shrink-0 text-slate-500">{dateTimeKo(q.created_at.toISOString())}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        {can(role, "subscriptions") && (
          <Card title="결제가 밀린 구독" action={<Link href="/admin/subscriptions?status=past_due" className="text-sm text-brand-600">전체</Link>}>
            {pastDue.length === 0 ? <Empty /> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {pastDue.map((s) => (
                  <li key={s.id} className="flex justify-between gap-2 py-2">
                    <Link href={`/admin/students/${s.user.id}`} className="truncate hover:text-brand-700">{s.user.name} · 실패 {s.failure_count}회</Link>
                    <span className="shrink-0 text-slate-500">{s.next_retry_at ? `다음 시도 ${dateTimeKo(s.next_retry_at.toISOString())}` : "-"}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
