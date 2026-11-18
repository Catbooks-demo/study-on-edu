import Link from "next/link";
import { notFound } from "next/navigation";
import { refundApproveAction, refundRejectAction } from "@/app/admin/actions";
import { Card, Dl, Flash, PageTitle, Pill, Table, Td, toneOf } from "@/components/admin/ui";
import { REFUND_STATUS_LABEL, dateTimeKo, pct1, won } from "@/lib/format";
import { refundDueAt } from "@/rules/deadlines";
import { type RefundCalc, refundCalculator } from "@/server/admin";
import { db } from "@/server/db";
import { HttpError } from "@/server/http";
import { type SP, guard } from "../../guard";

export const metadata = { title: "환불 상세" };

export default async function RefundDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  await guard("refunds");
  const r = await db.refund.findUnique({
    where: { id },
    include: {
      user: true,
      order_item: { include: { order: { include: { coupon: true } }, course: true, bundle: true } },
      invoice: { include: { subscription: { include: { plan: true } } } },
      payments: { orderBy: { created_at: "asc" } },
    },
  });
  if (!r) notFound();
  let calc: RefundCalc | null = null;
  let calcErr: string | null = null;
  try {
    calc = await refundCalculator(r.id);
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    calcErr = e.message;
  }
  const staffIds = r.decided_by ? await db.staff.findMany({ where: { id: r.decided_by }, select: { name: true } }) : [];
  const target = r.order_item ? (r.order_item.course?.title ?? r.order_item.bundle?.title ?? "") : `${r.invoice?.subscription.plan.name ?? "구독"} 청구`;
  const paid = r.order_item ? r.order_item.paid_amount : (r.invoice?.amount ?? 0);
  return (
    <>
      <PageTitle title="환불 상세" sub={target}>
        <Link href="/admin/refunds" className="text-sm text-slate-500 hover:underline">← 환불 목록</Link>
      </PageTitle>
      <Flash sp={sp} />
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <Card title="신청 내용">
            <Dl
              rows={[
                ["상태", <Pill key="s" tone={toneOf(r.status)} testId="refund-status">{REFUND_STATUS_LABEL[r.status] ?? r.status}</Pill>],
                ["수강생", <Link key="u" href={`/admin/students/${r.user.id}`} className="text-brand-700 hover:underline">{r.user.name} · {r.user.email}</Link>],
                ["주문", r.order_item ? <Link key="o" href={`/admin/orders/${r.order_item.order.code}`} className="hover:underline">{r.order_item.order.code}</Link> : "구독"],
                ["대상", target],
                ["낸 금액", <span key="p" className="tabular-nums">{won(paid)}{r.order_item?.order.coupon ? ` (쿠폰 ${r.order_item.order.coupon.code} 적용 뒤)` : ""}</span>],
                ["사유", r.reason],
                ["신청", dateTimeKo(r.created_at.toISOString())],
                ["신청 때 계산", <span key="c" className="tabular-nums">{won(r.calc_amount)}</span>],
                ["환불액", <span key="a" className="font-semibold tabular-nums">{won(r.amount)}</span>],
                ...(r.adjust_reason ? [["조정 사유", r.adjust_reason] as [string, string]] : []),
                ...(r.reject_reason ? [["거절 사유", r.reject_reason] as [string, string]] : []),
                ...(r.approved_at ? [["승인", `${dateTimeKo(r.approved_at.toISOString())} · ${staffIds[0]?.name ?? "직원"} · 기한 ${dateTimeKo(refundDueAt(r.approved_at).toISOString())}`] as [string, string]] : []),
                ...(r.done_at ? [["완료", dateTimeKo(r.done_at.toISOString())] as [string, string]] : []),
              ]}
            />
          </Card>
          <Card title="환불 결제">
            <Table head={["시각", "수단", "금액", "상태"]} empty={r.payments.length === 0} emptyText="아직 돌려준 결제가 없어요.">
              {r.payments.map((p) => (
                <tr key={p.id}>
                  <Td>{dateTimeKo((p.approved_at ?? p.created_at).toISOString())}</Td>
                  <Td>{p.method === "mock" ? "모의 결제" : "토스"}</Td>
                  <Td className="tabular-nums">{won(p.amount)}</Td>
                  <Td><Pill tone={toneOf(p.status)}>{p.status}</Pill>{p.failure_reason ? <span className="ml-2 text-xs text-rose-600">{p.failure_reason}</span> : null}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="환불 계산기">
            {calc ? (
              <>
                <p className="text-xs text-slate-500">지금 시각으로 다시 계산했어요. 실제 적용은 규칙대로 둘 중 작은 환불액이에요(7일 이내·진도 5% 미만이면 전액).</p>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg bg-slate-50 p-3">
                    <dt className="text-xs text-slate-500">{calc.kind === "course" ? "진도 방식" : "시청 방식"} · {pct1(calc.progress_ratio)}</dt>
                    <dd className="mt-1 text-lg font-bold tabular-nums" data-testid="calc-progress">{won(calc.progress_based)}</dd>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-3">
                    <dt className="text-xs text-slate-500">경과일 방식 · {calc.elapsed_days}일{calc.period_ratio !== null ? ` · ${pct1(calc.period_ratio)}` : ""}</dt>
                    <dd className="mt-1 text-lg font-bold tabular-nums" data-testid="calc-period">{calc.period_based === null ? "평생 강의라 없어요" : won(calc.period_based)}</dd>
                  </div>
                </dl>
                <div className="mt-2 rounded-lg bg-brand-50 p-3 ring-1 ring-brand-100">
                  <p className="text-xs text-brand-700">실제 적용</p>
                  <p className="mt-0.5 text-xl font-extrabold tabular-nums text-brand-800" data-testid="calc-applied">{won(calc.applied)}</p>
                  <p className="mt-1 text-xs text-slate-600">{calc.basis_ko}</p>
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-500">{calcErr ?? "계산할 수 없어요."}</p>
            )}
          </Card>

          {r.status === "requested" && (
            <>
              <Card title="승인">
                <form action={refundApproveAction} className="space-y-3 text-sm">
                  <input type="hidden" name="id" value={r.id} />
                  <div>
                    <label htmlFor="amount" className="label">환불액 (비우면 계산기 적용 값)</label>
                    <input id="amount" name="amount" inputMode="numeric" className="field" placeholder={calc ? String(calc.applied) : ""} />
                  </div>
                  <div>
                    <label htmlFor="adjust" className="label">금액을 바꾸면 사유</label>
                    <input id="adjust" name="reason" className="field" maxLength={500} placeholder="예: 강의 오류로 수강하지 못한 기간을 빼 줌" />
                  </div>
                  <button className="btn-primary w-full">승인하기</button>
                </form>
              </Card>
              <Card title="거절">
                <form action={refundRejectAction} className="space-y-3 text-sm">
                  <input type="hidden" name="id" value={r.id} />
                  <label htmlFor="reject" className="label">거절 사유 (수강생에게 보내요)</label>
                  <textarea id="reject" name="reason" required rows={3} maxLength={500} className="field" />
                  <button className="btn border border-rose-300 bg-white text-rose-700 hover:bg-rose-50">거절하기</button>
                </form>
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  );
}
