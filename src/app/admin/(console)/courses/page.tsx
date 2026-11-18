import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { Filters, Flash, PageTitle, Pager, Pill, Table, Td, toneOf } from "@/components/admin/ui";
import { COURSE_STATUS_LABEL, won } from "@/lib/format";
import { db } from "@/server/db";
import { type SP, guard, hrefWith, pageOf } from "../guard";

export const metadata = { title: "강의" };

const COURSE_STATUS = COURSE_STATUS_LABEL;
const TAKE = 40;

export default async function Courses({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await guard("catalog");
  const q = (sp.q ?? "").trim();
  const status = sp.status && COURSE_STATUS[sp.status] ? sp.status : "";
  const category = sp.category ?? "";
  const page = pageOf(sp.page);
  const where: Prisma.CourseWhereInput = {
    ...(status ? { status } : {}),
    ...(category ? { category: { code: category } } : {}),
    ...(q ? { OR: [{ code: { contains: q.toUpperCase() } }, { title: { contains: q } }, { instructor: { display_name: { contains: q } } }] } : {}),
  };
  const [rows, total, cats] = await Promise.all([
    db.course.findMany({
      where,
      include: { instructor: { select: { display_name: true } }, category: { select: { name: true } }, _count: { select: { enrollments: true } } },
      orderBy: { code: "asc" },
      skip: (page - 1) * TAKE,
      take: TAKE,
    }),
    db.course.count({ where }),
    db.category.findMany({ orderBy: { sort: "asc" } }),
  ]);
  return (
    <>
      <PageTitle title="강의" sub={`${total}개`} />
      <Flash sp={sp} />
      <Filters>
        <div><label htmlFor="q" className="label">코드·제목·강사</label><input id="q" name="q" defaultValue={q} className="field w-56" /></div>
        <div>
          <label htmlFor="category" className="label">분야</label>
          <select id="category" name="category" defaultValue={category} className="field">
            <option value="">전체</option>
            {cats.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="status" className="label">상태</label>
          <select id="status" name="status" defaultValue={status} className="field">
            <option value="">전체</option>
            {Object.entries(COURSE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </Filters>
      <Table head={["코드", "제목", "분야", "강사", "가격", "구독", "수강생", "평점", "상태"]} empty={rows.length === 0}>
        {rows.map((c) => (
          <tr key={c.id} className="hover:bg-slate-50">
            <Td className="font-mono text-xs"><Link href={`/admin/courses/${c.code}`} className="text-brand-700 hover:underline">{c.code}</Link></Td>
            <Td className="max-w-72 truncate">{c.title}</Td>
            <Td>{c.category.name}</Td>
            <Td>{c.instructor.display_name}</Td>
            <Td className="tabular-nums">{c.sale_price !== null && c.sale_ends_at && c.sale_ends_at > new Date() ? <><s className="text-slate-400">{won(c.price)}</s> {won(c.sale_price)}</> : won(c.price)}</Td>
            <Td>{c.in_subscription ? "대상" : "-"}</Td>
            <Td className="tabular-nums">{c._count.enrollments}</Td>
            <Td className="tabular-nums">{c.rating_count ? `${c.rating_avg.toFixed(1)} (${c.rating_count})` : "-"}</Td>
            <Td><Pill tone={toneOf(c.status)}>{COURSE_STATUS[c.status] ?? c.status}</Pill></Td>
          </tr>
        ))}
      </Table>
      <Pager page={page} pages={Math.max(1, Math.ceil(total / TAKE))} href={(p) => hrefWith("/admin/courses", sp, { page: p })} />
    </>
  );
}
