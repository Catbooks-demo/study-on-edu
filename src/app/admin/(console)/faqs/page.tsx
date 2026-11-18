import { faqCreateAction, faqToggleAction } from "@/app/admin/actions";
import { ActionButton, Card, Flash, PageTitle, Pill, Table, Td } from "@/components/admin/ui";
import { db } from "@/server/db";
import { FAQ_CATEGORIES } from "@/server/support";
import { type SP, guard } from "../guard";

export const metadata = { title: "FAQ" };

export default async function Faqs({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await guard("content_pages");
  const rows = await db.faq.findMany({ orderBy: [{ category: "asc" }, { sort: "asc" }] });
  return (
    <>
      <PageTitle title="FAQ" sub="고객센터 자주 묻는 질문이에요. 같은 분야 안에서는 순서 숫자가 작은 것부터 보여요." />
      <Flash sp={sp} />
      <Table head={["분야", "순서", "질문", "상태", ""]} empty={rows.length === 0}>
        {rows.map((f) => (
          <tr key={f.id}>
            <Td>{FAQ_CATEGORIES[f.category] ?? f.category}</Td>
            <Td className="tabular-nums">{f.sort}</Td>
            <Td className="max-w-xl whitespace-normal">{f.question}<p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{f.answer}</p></Td>
            <Td>{f.published ? <Pill tone="green">게시 중</Pill> : <Pill tone="gray">내림</Pill>}</Td>
            <Td><ActionButton action={faqToggleAction} fields={{ id: f.id }} label={f.published ? "내리기" : "다시 올리기"} /></Td>
          </tr>
        ))}
      </Table>
      <Card title="새 FAQ" className="mt-6">
        <form action={faqCreateAction} className="grid gap-3 text-sm sm:grid-cols-4">
          <div>
            <label htmlFor="category" className="label">분야</label>
            <select id="category" name="category" className="field">{Object.entries(FAQ_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </div>
          <div><label htmlFor="sort" className="label">순서</label><input id="sort" name="sort" inputMode="numeric" defaultValue={0} className="field" /></div>
          <div className="sm:col-span-4"><label htmlFor="question" className="label">질문</label><input id="question" name="question" required maxLength={300} className="field" /></div>
          <div className="sm:col-span-4"><label htmlFor="answer" className="label">답</label><textarea id="answer" name="answer" required rows={4} className="field" /></div>
          <button className="btn-primary">올리기</button>
        </form>
      </Card>
    </>
  );
}
