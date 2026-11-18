import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { Filters, Flash, PageTitle, Pager, Table, Td } from "@/components/admin/ui";
import { dateTimeKo } from "@/lib/format";
import { db } from "@/server/db";
import { type SP, guard, hrefWith, pageOf } from "../guard";

export const metadata = { title: "수강생" };

const TAKE = 40;

export default async function Students({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await guard("students");
  const q = (sp.q ?? "").trim();
  const page = pageOf(sp.page);
  const where: Prisma.UserWhereInput = q
    ? { OR: [{ email: { contains: q, mode: "insensitive" } }, { name: { contains: q } }, { phone: { contains: q.replace(/[^0-9]/g, "") || q } }] }
    : {};
  const [rows, total] = await Promise.all([
    db.user.findMany({
      where,
      include: { _count: { select: { enrollments: true, orders: true, devices: { where: { revoked_at: null } } } } },
      orderBy: { created_at: "desc" },
      skip: (page - 1) * TAKE,
      take: TAKE,
    }),
    db.user.count({ where }),
  ]);
  return (
    <>
      <PageTitle title="수강생" sub={`${total.toLocaleString("ko-KR")}명`} />
      <Flash sp={sp} />
      <Filters>
        <div><label htmlFor="q" className="label">이름·이메일·휴대폰</label><input id="q" name="q" defaultValue={q} className="field w-64" /></div>
      </Filters>
      <Table head={["이름", "이메일", "가입", "수강권", "주문", "등록 기기"]} empty={rows.length === 0}>
        {rows.map((u) => (
          <tr key={u.id} className="hover:bg-slate-50">
            <Td><Link href={`/admin/students/${u.id}`} className="font-medium text-brand-700 hover:underline">{u.name}</Link></Td>
            <Td className="text-slate-600">{u.email}</Td>
            <Td className="text-slate-500">{dateTimeKo(u.created_at.toISOString())}</Td>
            <Td className="tabular-nums">{u._count.enrollments}</Td>
            <Td className="tabular-nums">{u._count.orders}</Td>
            <Td className="tabular-nums">{u._count.devices}/2</Td>
          </tr>
        ))}
      </Table>
      <Pager page={page} pages={Math.max(1, Math.ceil(total / TAKE))} href={(p) => hrefWith("/admin/students", sp, { page: p })} />
    </>
  );
}
