import Link from "next/link";
import { inquiryAnswerAction } from "@/app/admin/actions";
import { Card, Flash, PageTitle, Pill, Tabs } from "@/components/admin/ui";
import { dateTimeKo } from "@/lib/format";
import { db } from "@/server/db";
import { INQUIRY_CATEGORY_LABEL, type InquiryCategory } from "@/server/inquiries";
import { type SP, guard } from "../guard";

export const metadata = { title: "1:1 문의" };

export default async function Inquiries({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await guard("support");
  const status = sp.status === "answered" ? "answered" : sp.status === "all" ? "" : "open";
  const rows = await db.inquiry.findMany({
    where: status ? { status } : {},
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { created_at: status === "open" ? "asc" : "desc" },
    take: 100,
  });
  const back = `/admin/inquiries${status === "open" ? "" : `?status=${status || "all"}`}`;
  return (
    <>
      <PageTitle title="1:1 문의" sub="답변하면 수강생 메일함(보낸 편지함)으로 나가요. 다시 답하면 답변이 바뀌어요." />
      <Flash sp={sp} />
      <Tabs current={status || "all"} items={[{ key: "open", label: "답변 대기", href: "/admin/inquiries" }, { key: "answered", label: "답변함", href: "/admin/inquiries?status=answered" }, { key: "all", label: "전체", href: "/admin/inquiries?status=all" }]} />
      {rows.length === 0 && <Card><p className="text-sm text-slate-500">문의가 없어요.</p></Card>}
      <div className="space-y-3">
        {rows.map((q) => (
          <Card key={q.id}>
            <div id={q.id} className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xs text-slate-500">{INQUIRY_CATEGORY_LABEL[q.category as InquiryCategory] ?? q.category} · <Link href={`/admin/students/${q.user.id}`} className="hover:underline">{q.user.name}</Link> · {dateTimeKo(q.created_at.toISOString())}</p>
                <h2 className="font-bold">{q.title}</h2>
              </div>
              <Pill tone={q.status === "open" ? "amber" : "green"}>{q.status === "open" ? "답변 대기" : "답변함"}</Pill>
            </div>
            <p className="mt-2 whitespace-pre-line text-sm text-slate-700">{q.body}</p>
            {q.answer && <p className="mt-3 whitespace-pre-line rounded-lg bg-brand-50 p-3 text-sm">{q.answer}<span className="mt-1 block text-xs text-slate-500">{q.answered_at ? dateTimeKo(q.answered_at.toISOString()) : ""} · {q.answered_by}</span></p>}
            <form action={inquiryAnswerAction} className="mt-3 space-y-2">
              <input type="hidden" name="id" value={q.id} />
              <input type="hidden" name="back" value={back} />
              <label htmlFor={`a-${q.id}`} className="sr-only">답변</label>
              <textarea id={`a-${q.id}`} name="answer" rows={3} required maxLength={5000} defaultValue={q.answer ?? ""} className="field" placeholder="안녕하세요, 스터디온에듀예요. …" />
              <button className="btn-primary px-3 py-2">{q.answer ? "답변 고치기" : "답변 보내기"}</button>
            </form>
          </Card>
        ))}
      </div>
    </>
  );
}
