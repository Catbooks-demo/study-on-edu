import Link from "next/link";
import { settlementComputeAction, settlementConfirmAction } from "@/app/admin/actions";
import { ActionButton, Card, Flash, PageTitle, Pill, Table, Td, toneOf } from "@/components/admin/ui";
import { won } from "@/lib/format";
import { PAY_DAY } from "@/rules/settlement";
import { kstMonth, prevMonth } from "@/rules/time";
import { db } from "@/server/db";
import { type SP, guard } from "../guard";

export const metadata = { title: "정산" };

const LINE_KO: Record<string, string> = { sale: "판매 70%", referral: "추천 90%", subscription: "구독 몫", refund: "환불 차감", carry: "앞달 이월" };

export default async function Settlements({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await guard("settlements");
  const thisMonth = kstMonth(new Date());
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.month ?? "") && sp.month! <= thisMonth ? sp.month! : prevMonth(thisMonth);
  const months = Array.from({ length: 6 }, (_, i) => {
    let m = thisMonth;
    for (let k = 0; k < i; k++) m = prevMonth(m);
    return m;
  });
  const rows = await db.settlement.findMany({
    where: { month },
    include: { instructor: { select: { id: true, display_name: true } }, lines: { orderBy: [{ kind: "asc" }, { created_at: "asc" }] } },
    orderBy: { payout: "desc" },
  });
  const sum = (k: "payout" | "sales_share" | "referral_share" | "subscription_share" | "refund_deduction") => rows.reduce((a, r) => a + r[k], 0);
  const back = `/admin/settlements?month=${month}`;
  const drafts = rows.filter((r) => r.status === "draft").length;
  return (
    <>
      <PageTitle title="정산" sub={`매월 1일(한국 시간)에 전월분을 자동으로 계산해요. 확정하면 다음 달 ${PAY_DAY}일 지급 예정으로 강사 화면에 보여요.`}>
        <form action={settlementComputeAction}>
          <input type="hidden" name="month" value={month} />
          <button className="btn-line px-3 py-2">{month} 다시 계산</button>
        </form>
      </PageTitle>
      <Flash sp={sp} />
      <nav aria-label="정산 달" className="mb-4 flex flex-wrap gap-1 text-sm">
        {months.map((m) => (
          <Link key={m} href={`/admin/settlements?month=${m}`} aria-current={m === month ? "page" : undefined} className={`rounded-full px-3 py-1 ${m === month ? "bg-ink text-white" : "bg-white ring-1 ring-slate-200"}`}>
            {m}{m === thisMonth ? " (진행 중)" : ""}
          </Link>
        ))}
      </nav>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          ["판매 몫", sum("sales_share")],
          ["추천 몫", sum("referral_share")],
          ["구독 몫", sum("subscription_share")],
          ["환불 차감", -sum("refund_deduction")],
          ["지급 합계", sum("payout")],
        ].map(([label, v]) => (
          <Card key={label as string}><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-lg font-bold tabular-nums">{won(v as number)}</p></Card>
        ))}
      </div>
      {month === thisMonth && <p className="mb-3 rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-800">이번 달은 아직 끝나지 않았어요. 지금 계산하면 오늘까지의 숫자예요.</p>}
      <Table head={["강사", "판매", "추천", "구독", "환불 차감", "이월", "합계", "지급액", "지급일", "상태", ""]} empty={rows.length === 0} emptyText="이 달 정산이 아직 없어요. 다시 계산을 눌러 보세요.">
        {rows.map((s) => (
          <tr key={s.id} className="align-top">
            <Td>
              <Link href={`/admin/instructors/${s.instructor.id}`} className="font-medium text-brand-700 hover:underline">{s.instructor.display_name}</Link>
              <details className="mt-1 text-xs text-slate-600">
                <summary className="cursor-pointer text-slate-400">줄 {s.lines.length}개</summary>
                <ul className="mt-1 space-y-0.5">
                  {s.lines.map((l) => (
                    <li key={l.id} className="tabular-nums">{LINE_KO[l.kind] ?? l.kind} · {l.ref} · {won(l.base_amount)} → {won(l.amount)}</li>
                  ))}
                </ul>
              </details>
            </Td>
            <Td className="tabular-nums">{won(s.sales_share)}<div className="text-xs text-slate-400">{won(s.sales_amount)}의 70%</div></Td>
            <Td className="tabular-nums">{won(s.referral_share)}</Td>
            <Td className="tabular-nums">{won(s.subscription_share)}</Td>
            <Td className="tabular-nums text-rose-600">{s.refund_deduction ? `−${won(s.refund_deduction)}` : "-"}</Td>
            <Td className="tabular-nums text-rose-600">{s.carried_in ? won(s.carried_in) : "-"}</Td>
            <Td className="tabular-nums">{won(s.total)}{s.total < 0 && <div className="text-xs text-rose-600">다음 달로 이월</div>}</Td>
            <Td className="tabular-nums font-semibold">{won(s.payout)}</Td>
            <Td>{s.pay_date}</Td>
            <Td><Pill tone={toneOf(s.status)}>{s.status === "confirmed" ? "확정" : "계산됨"}</Pill></Td>
            <Td>{s.status === "draft" && <ActionButton action={settlementConfirmAction} fields={{ id: s.id, back }} label="확정" tone="primary" confirm={`${s.instructor.display_name} ${s.month} 정산 ${won(s.payout)}을 확정할까요?`} />}</Td>
          </tr>
        ))}
      </Table>
      {drafts > 0 && <p className="mt-2 text-xs text-slate-500">확정하지 않은 정산 {drafts}건은 다시 계산할 때마다 새 숫자로 바뀌어요.</p>}
    </>
  );
}
