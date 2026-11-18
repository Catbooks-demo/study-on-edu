import Link from "next/link";
import { notFound } from "next/navigation";
import { instructorStatusAction, settlementConfirmAction } from "@/app/admin/actions";
import { DemoBadge } from "@/components/DemoBadge";
import { InstructorAvatar } from "@/components/InstructorAvatar";
import { ActionButton, Card, Dl, Flash, PageTitle, Pill, Table, Td, toneOf } from "@/components/admin/ui";
import { COURSE_STATUS_LABEL, won } from "@/lib/format";
import { db } from "@/server/db";
import { can } from "@/server/roles";
import { instructorSettlements } from "@/server/settlements";
import { type SP, guard } from "../../guard";

export const metadata = { title: "강사 상세" };

const COURSE_STATUS = COURSE_STATUS_LABEL;

export default async function InstructorDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const st = await guard("instructors");
  const i = await db.instructor.findUnique({
    where: { id },
    include: {
      users: { select: { email: true } },
      courses: { include: { _count: { select: { enrollments: true, lectures: true } } }, orderBy: { code: "asc" } },
      coupons: { where: { referral: true } },
    },
  });
  if (!i) notFound();
  const settlements = can(st.role, "settlements") ? await instructorSettlements(i.id) : [];
  const back = `/admin/instructors/${i.id}`;
  return (
    <>
      <PageTitle title={i.display_name} sub={`/instructors/${i.slug}`}>
        <Link href="/admin/instructors" className="text-sm text-slate-500 hover:underline">← 강사 목록</Link>
      </PageTitle>
      <Flash sp={sp} />
      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <Card>
          <div className="flex items-center gap-3">
            <InstructorAvatar slug={i.slug} name={i.display_name} size={48} />
            <div>
              <p className="font-bold">{i.display_name}</p>
              <DemoBadge />
            </div>
          </div>
          <p className="mt-3 text-sm text-slate-600">{i.bio}</p>
          <div className="mt-3">
            <Dl
              rows={[
                ["상태", i.status === "active" ? <Pill key="a" tone="green">활동 중</Pill> : <Pill key="s" tone="red">활동 멈춤</Pill>],
                ["계정", i.users.map((u) => u.email).join(", ") || "-"],
                ["정산 계좌", i.account_last4 ? `····${i.account_last4}` : "미등록"],
                ["추천 코드", i.coupons.map((c) => c.code).join(", ") || "-"],
              ]}
            />
          </div>
          <div className="mt-4">
            {i.status === "active" ? (
              <ActionButton action={instructorStatusAction} fields={{ id: i.id, status: "suspended" }} label="활동 멈추기" tone="danger" confirm="강사 활동을 멈추면 강사 페이지가 안 보이고 강사 화면 로그인이 끊겨요. 멈출까요?" />
            ) : (
              <ActionButton action={instructorStatusAction} fields={{ id: i.id, status: "active" }} label="활동 다시 켜기" />
            )}
          </div>
        </Card>
        <div className="space-y-4">
          <Card title="강의">
            <Table head={["코드", "제목", "상태", "강", "수강생", "평점"]} empty={i.courses.length === 0}>
              {i.courses.map((c) => (
                <tr key={c.id}>
                  <Td className="font-mono text-xs"><Link href={`/admin/courses/${c.code}`} className="text-brand-700 hover:underline">{c.code}</Link></Td>
                  <Td className="max-w-72 truncate">{c.title}</Td>
                  <Td><Pill tone={toneOf(c.status)}>{COURSE_STATUS[c.status] ?? c.status}</Pill></Td>
                  <Td className="tabular-nums">{c._count.lectures}</Td>
                  <Td className="tabular-nums">{c._count.enrollments}</Td>
                  <Td className="tabular-nums">{c.rating_count ? `${c.rating_avg.toFixed(1)} (${c.rating_count})` : "-"}</Td>
                </tr>
              ))}
            </Table>
          </Card>
          {can(st.role, "settlements") && (
            <Card title="정산 내역">
              <Table head={["달", "판매", "추천", "구독", "환불 차감", "이월", "합계", "지급액", "지급일", "상태", ""]} empty={settlements.length === 0}>
                {settlements.map((s) => (
                  <tr key={s.id}>
                    <Td>{s.month}</Td>
                    <Td className="tabular-nums">{won(s.sales_share)}</Td>
                    <Td className="tabular-nums">{won(s.referral_share)}</Td>
                    <Td className="tabular-nums">{won(s.subscription_share)}</Td>
                    <Td className="tabular-nums text-rose-600">{s.refund_deduction ? `−${won(s.refund_deduction)}` : "-"}</Td>
                    <Td className="tabular-nums text-rose-600">{s.carried_in ? won(s.carried_in) : "-"}</Td>
                    <Td className="tabular-nums">{won(s.total)}</Td>
                    <Td className="tabular-nums font-semibold">{won(s.payout)}</Td>
                    <Td>{s.pay_date}</Td>
                    <Td><Pill tone={toneOf(s.status)}>{s.status === "confirmed" ? "확정" : "계산됨"}</Pill></Td>
                    <Td>{s.status === "draft" && <ActionButton action={settlementConfirmAction} fields={{ id: s.id, back }} label="확정" tone="primary" confirm={`${s.month} 정산 ${won(s.payout)}을 확정할까요? 확정하면 다시 계산해도 바뀌지 않아요.`} />}</Td>
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
