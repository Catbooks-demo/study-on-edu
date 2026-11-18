import Link from "next/link";
import { notFound } from "next/navigation";
import { deviceRevokeAction, subscriptionRetryAction } from "@/app/admin/actions";
import { ActionButton, Card, Dl, Flash, PageTitle, Pill, Table, Td, toneOf } from "@/components/admin/ui";
import { ENROLLMENT_SOURCE_LABEL, ORDER_STATUS_LABEL, SUBSCRIPTION_STATUS_LABEL, dateShort, dateTimeKo, pct1, won } from "@/lib/format";
import { kstDate } from "@/rules/time";
import { db } from "@/server/db";
import { courseProgressFor } from "@/server/player";
import { can } from "@/server/roles";
import { type SP, guard } from "../../guard";

export const metadata = { title: "수강생 상세" };

const ENROLL_STATUS: Record<string, string> = { active: "수강 중", expired: "만료", refunded: "환불" };

export default async function StudentDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const st = await guard("students");
  const u = await db.user.findUnique({
    where: { id },
    include: {
      enrollments: { include: { course: { select: { id: true, code: true, title: true } } }, orderBy: { created_at: "desc" } },
      devices: { orderBy: { last_seen_at: "desc" } },
      orders: { orderBy: { created_at: "desc" }, take: 20 },
      subscriptions: { include: { plan: true, invoices: { orderBy: { period_start: "desc" }, take: 1 } }, orderBy: { created_at: "desc" } },
      certificates: { include: { course: { select: { title: true } } } },
      _count: { select: { questions: true, reviews: true, inquiries: true } },
    },
  });
  if (!u) notFound();
  const progress = await Promise.all(u.enrollments.map((e) => courseProgressFor(db, u.id, e.course.id)));
  const back = `/admin/students/${u.id}`;
  const subs = u.subscriptions.filter((s) => s.invoices.length || s.status !== "expired");
  return (
    <>
      <PageTitle title={u.name} sub={`${u.email} · 가입 ${dateTimeKo(u.created_at.toISOString())}`}>
        <Link href="/admin/students" className="text-sm text-slate-500 hover:underline">← 수강생 목록</Link>
      </PageTitle>
      <Flash sp={sp} />
      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <div className="space-y-4">
          <Card title="회원 정보">
            <Dl
              rows={[
                ["휴대폰", u.phone.replace(/^(\d{3})(\d{3,4})(\d{4})$/, "$1-$2-$3")],
                ["태어난 해", u.birth_year ?? "-"],
                ["관심 분야", u.interests.join(", ") || "-"],
                ["마케팅 수신", u.marketing_opt_in ? "동의" : "거부"],
                ["질문·후기·문의", `${u._count.questions} · ${u._count.reviews} · ${u._count.inquiries}`],
                ["수료증", u.certificates.length ? u.certificates.map((c) => `${c.number} ${c.course.title}`).join(", ") : "-"],
              ]}
            />
          </Card>
          <Card title="등록 기기">
            <p className="mb-2 text-xs text-slate-500">최대 2대예요. 해제하면 수강생이 새 기기를 등록할 수 있어요.</p>
            {u.devices.length === 0 ? <p className="text-sm text-slate-400">없어요.</p> : (
              <ul className="divide-y divide-slate-100 text-sm">
                {u.devices.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 py-2">
                    <span>
                      {d.name}
                      <span className="block text-xs text-slate-500">마지막 {dateTimeKo(d.last_seen_at.toISOString())}{d.revoked_at ? ` · ${dateShort(kstDate(d.revoked_at))} 해제` : ""}</span>
                    </span>
                    {!d.revoked_at && can(st.role, "students") && <ActionButton action={deviceRevokeAction} fields={{ id: d.id, back }} label="해제" confirm={`${d.name} 기기를 해제할까요?`} />}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="구독">
            {subs.length === 0 ? <p className="text-sm text-slate-400">없어요.</p> : subs.map((s) => (
              <div key={s.id} className="border-b border-slate-100 py-2 text-sm last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <span>{s.plan.name}</span>
                  <Pill tone={toneOf(s.status)}>{SUBSCRIPTION_STATUS_LABEL[s.status]}</Pill>
                </div>
                <p className="text-xs text-slate-500">{dateShort(kstDate(s.current_period_start))} ~ {dateShort(kstDate(s.current_period_end))}{s.cancel_at_period_end ? " · 해지 예약" : ""} · 카드 ····{s.card_last4}</p>
                {s.status === "past_due" && can(st.role, "subscriptions") && <div className="mt-1"><ActionButton action={subscriptionRetryAction} fields={{ id: s.id, back }} label="지금 다시 결제" /></div>}
              </div>
            ))}
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="수강권·진도">
            <Table head={["강의", "출처", "상태", "만료", "진도", "완료 강"]} empty={u.enrollments.length === 0}>
              {u.enrollments.map((e, i) => {
                const p = progress[i];
                return (
                  <tr key={e.id}>
                    <Td className="max-w-72 truncate"><Link href={`/admin/courses/${e.course.code}`} className="hover:underline">{e.course.title}</Link></Td>
                    <Td>{ENROLLMENT_SOURCE_LABEL[e.source] ?? e.source}</Td>
                    <Td><Pill tone={toneOf(e.status)}>{ENROLL_STATUS[e.status] ?? e.status}</Pill></Td>
                    <Td className="text-slate-500">{e.expires_at ? dateShort(kstDate(e.expires_at)) : e.source === "subscription" ? "구독 동안" : "평생"}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-brand-500" style={{ width: `${Math.round(p.ratio * 100)}%` }} /></div>
                        <span className="tabular-nums text-xs">{pct1(p.ratio)}</span>
                      </div>
                    </Td>
                    <Td className="tabular-nums text-slate-500">{p.lectures.filter((l) => l.done).length}/{p.lectures.length}</Td>
                  </tr>
                );
              })}
            </Table>
          </Card>
          {can(st.role, "orders") && (
            <Card title="주문">
              <Table head={["주문번호", "시각", "결제액", "상태"]} empty={u.orders.length === 0}>
                {u.orders.map((o) => (
                  <tr key={o.id}>
                    <Td><Link href={`/admin/orders/${o.code}`} className="text-brand-700 hover:underline">{o.code}</Link></Td>
                    <Td className="text-slate-500">{dateTimeKo(o.created_at.toISOString())}</Td>
                    <Td className="tabular-nums">{won(o.payable)}</Td>
                    <Td><Pill tone={toneOf(o.status)}>{ORDER_STATUS_LABEL[o.status]}</Pill></Td>
                  </tr>
                ))}
              </Table>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
