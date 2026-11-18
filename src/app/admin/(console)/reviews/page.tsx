import type { Prisma } from "@prisma/client";
import { reviewHideAction } from "@/app/admin/actions";
import { ActionButton, Filters, Flash, PageTitle, Pager, Pill, Table, Td } from "@/components/admin/ui";
import { dateTimeKo } from "@/lib/format";
import { db } from "@/server/db";
import { type SP, guard, hrefWith, pageOf } from "../guard";

export const metadata = { title: "후기" };

const TAKE = 40;

export default async function Reviews({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await guard("support");
  const page = pageOf(sp.page);
  const rating = Number(sp.rating) || 0;
  const where: Prisma.ReviewWhereInput = {
    ...(sp.hidden === "1" ? { hidden: true } : {}),
    ...(rating >= 1 && rating <= 5 ? { rating } : {}),
    ...(sp.q ? { OR: [{ body: { contains: sp.q } }, { course: { title: { contains: sp.q } } }] } : {}),
  };
  const [rows, total] = await Promise.all([
    db.review.findMany({ where, include: { user: { select: { name: true } }, course: { select: { code: true, title: true } } }, orderBy: { created_at: "desc" }, skip: (page - 1) * TAKE, take: TAKE }),
    db.review.count({ where }),
  ]);
  const back = hrefWith("/admin/reviews", sp, {});
  return (
    <>
      <PageTitle title="후기" sub="숨긴 후기는 강의 화면과 평점에서 빠져요. 숨김·보이기는 작업 기록에 남아요." />
      <Flash sp={sp} />
      <Filters>
        <div><label htmlFor="q" className="label">내용·강의</label><input id="q" name="q" defaultValue={sp.q ?? ""} className="field w-56" /></div>
        <div>
          <label htmlFor="rating" className="label">별점</label>
          <select id="rating" name="rating" defaultValue={rating || ""} className="field"><option value="">전체</option>{[1, 2, 3, 4, 5].map((r) => <option key={r} value={r}>{r}점</option>)}</select>
        </div>
        <label className="flex items-center gap-2 pb-2"><input type="checkbox" name="hidden" value="1" defaultChecked={sp.hidden === "1"} /> 숨긴 것만</label>
      </Filters>
      <Table head={["작성", "강의", "수강생", "별점", "내용", "상태", ""]} empty={rows.length === 0}>
        {rows.map((r) => (
          <tr key={r.id} className={r.hidden ? "bg-slate-50 text-slate-400" : ""}>
            <Td>{dateTimeKo(r.created_at.toISOString())}</Td>
            <Td className="max-w-48 truncate">{r.course.title}</Td>
            <Td>{r.user.name}</Td>
            <Td className="tabular-nums text-lemon-600">{"★".repeat(r.rating)}<span className="text-slate-200">{"★".repeat(5 - r.rating)}</span></Td>
            <Td className="max-w-md whitespace-normal">{r.body}</Td>
            <Td>{r.hidden ? <Pill tone="red">숨김</Pill> : <Pill tone="green">보임</Pill>}</Td>
            <Td><ActionButton action={reviewHideAction} fields={{ id: r.id, hidden: r.hidden ? "false" : "true", back }} label={r.hidden ? "보이기" : "숨기기"} /></Td>
          </tr>
        ))}
      </Table>
      <Pager page={page} pages={Math.max(1, Math.ceil(total / TAKE))} href={(p) => hrefWith("/admin/reviews", sp, { page: p })} />
    </>
  );
}
