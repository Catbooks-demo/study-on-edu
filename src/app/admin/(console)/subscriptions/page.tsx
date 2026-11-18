import Link from "next/link";
import { subscriptionRetryAction } from "@/app/admin/actions";
import { ActionButton, Filters, Flash, PageTitle, Pager, Pill, Table, Tabs, Td, toneOf } from "@/components/admin/ui";
import { INVOICE_STATUS_LABEL, SUBSCRIPTION_STATUS_LABEL, dateShort, dateTimeKo, won } from "@/lib/format";
import { kstDate } from "@/rules/time";
import { adminSubscriptions } from "@/server/admin";
import { type SP, guard, hrefWith, pageOf } from "../guard";

export const metadata = { title: "구독" };

export default async function Subscriptions({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await guard("subscriptions");
  const status = sp.status && SUBSCRIPTION_STATUS_LABEL[sp.status] ? sp.status : "";
  const includeUnpaid = sp.unpaid === "1";
  const page = pageOf(sp.page);
  const { items, total, pages } = await adminSubscriptions({ status: status || undefined, q: sp.q?.trim() || undefined, includeUnpaid, page });
  const back = hrefWith("/admin/subscriptions", sp, {});
  return (
    <>
      <PageTitle title="구독" sub={`${total.toLocaleString("ko-KR")}건. 결제 한 번 없이 끝난 가입은 기본으로 빼고 보여요.`} />
      <Flash sp={sp} />
      <Tabs
        current={status || "all"}
        items={[
          { key: "all", label: "전체", href: hrefWith("/admin/subscriptions", sp, { status: undefined, page: undefined }) },
          ...Object.entries(SUBSCRIPTION_STATUS_LABEL).map(([k, v]) => ({ key: k, label: v, href: hrefWith("/admin/subscriptions", sp, { status: k, page: undefined }) })),
        ]}
      />
      <Filters>
        <input type="hidden" name="status" value={status} />
        <div><label htmlFor="q" className="label">이메일·이름</label><input id="q" name="q" defaultValue={sp.q ?? ""} className="field w-56" /></div>
        <label className="flex items-center gap-2 pb-2"><input type="checkbox" name="unpaid" value="1" defaultChecked={includeUnpaid} /> 결제 전 가입도 보기</label>
      </Filters>
      <Table head={["수강생", "플랜", "상태", "현재 기간", "카드", "실패", "최근 청구", ""]} empty={items.length === 0}>
        {items.map((s) => (
          <tr key={s.id} className={`hover:bg-slate-50 ${s.never_paid ? "opacity-60" : ""}`}>
            <Td><Link href={`/admin/students/${s.user.id}`} className="text-brand-700 hover:underline">{s.user.name}</Link><div className="text-xs text-slate-500">{s.user.email}</div></Td>
            <Td>{s.plan.name}<div className="text-xs text-slate-500">{won(s.plan.price)}</div></Td>
            <Td>
              {s.never_paid ? <Pill tone="gray">결제 전 가입</Pill> : <Pill tone={toneOf(s.status)}>{SUBSCRIPTION_STATUS_LABEL[s.status] ?? s.status}</Pill>}
              {s.cancel_at_period_end && s.status !== "cancelled" && <div className="mt-1 text-xs text-amber-700">해지 예약</div>}
              {s.paused_until && <div className="mt-1 text-xs text-sky-700">{dateShort(kstDate(s.paused_until))}까지 정지</div>}
            </Td>
            <Td className="text-slate-600">{dateShort(kstDate(s.current_period_start))} ~ {dateShort(kstDate(s.current_period_end))}</Td>
            <Td className="text-slate-600">{s.card_label} ····{s.card_last4}</Td>
            <Td>{s.failure_count ? <span className="text-rose-600">{s.failure_count}회{s.next_retry_at ? ` · 다음 ${dateTimeKo(s.next_retry_at.toISOString())}` : ""}</span> : "-"}</Td>
            <Td>{s.invoices[0] ? <span className="text-xs">{INVOICE_STATUS_LABEL[s.invoices[0].status]} · {won(s.invoices[0].amount)}</span> : "-"}</Td>
            <Td>{s.status === "past_due" && <ActionButton action={subscriptionRetryAction} fields={{ id: s.id, back }} label="지금 다시 결제" />}</Td>
          </tr>
        ))}
      </Table>
      <Pager page={page} pages={pages} href={(p) => hrefWith("/admin/subscriptions", sp, { page: p })} />
    </>
  );
}
