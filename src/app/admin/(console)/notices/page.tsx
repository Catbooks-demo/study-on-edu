import { noticeCreateAction, noticeToggleAction } from "@/app/admin/actions";
import { ActionButton, Card, Flash, PageTitle, Pill, Table, Td } from "@/components/admin/ui";
import { dateTimeKo } from "@/lib/format";
import { db } from "@/server/db";
import { type SP, guard } from "../guard";

export const metadata = { title: "공지" };

export default async function Notices({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await guard("content_pages");
  const rows = await db.notice.findMany({ orderBy: [{ pinned: "desc" }, { created_at: "desc" }] });
  return (
    <>
      <PageTitle title="공지" sub="올린 공지는 고객센터와 메인 화면에 보여요." />
      <Flash sp={sp} />
      <Table head={["올린 때", "제목", "상태", ""]} empty={rows.length === 0}>
        {rows.map((n) => (
          <tr key={n.id}>
            <Td className="text-slate-500">{dateTimeKo(n.created_at.toISOString())}</Td>
            <Td className="max-w-xl whitespace-normal">{n.pinned && <Pill tone="brand">고정</Pill>} {n.title}</Td>
            <Td>{n.published ? <Pill tone="green">게시 중</Pill> : <Pill tone="gray">내림</Pill>}</Td>
            <Td className="space-x-1">
              <ActionButton action={noticeToggleAction} fields={{ id: n.id, field: "pinned" }} label={n.pinned ? "고정 풀기" : "고정"} />
              <ActionButton action={noticeToggleAction} fields={{ id: n.id, field: "published" }} label={n.published ? "내리기" : "다시 올리기"} />
            </Td>
          </tr>
        ))}
      </Table>
      <Card title="새 공지" className="mt-6">
        <form action={noticeCreateAction} className="space-y-3 text-sm">
          <div><label htmlFor="title" className="label">제목</label><input id="title" name="title" required maxLength={200} className="field" /></div>
          <div><label htmlFor="body" className="label">내용</label><textarea id="body" name="body" required rows={5} className="field" /></div>
          <label className="flex items-center gap-2"><input type="checkbox" name="pinned" /> 맨 위에 고정</label>
          <button className="btn-primary">올리기</button>
        </form>
      </Card>
    </>
  );
}
