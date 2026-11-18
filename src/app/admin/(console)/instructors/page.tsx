import Link from "next/link";
import { DemoBadge } from "@/components/DemoBadge";
import { InstructorAvatar } from "@/components/InstructorAvatar";
import { Flash, PageTitle, Pill, Table, Td } from "@/components/admin/ui";
import { db } from "@/server/db";
import { type SP, guard } from "../guard";

export const metadata = { title: "강사" };

export default async function Instructors({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await guard("instructors");
  const rows = await db.instructor.findMany({
    include: { courses: { select: { status: true, rating_avg: true, rating_count: true } }, users: { select: { email: true } } },
    orderBy: { display_name: "asc" },
  });
  return (
    <>
      <PageTitle title="강사" sub="모든 강사는 시연용 가상 인물이에요. 실명·사진·경력을 쓰지 않아요." />
      <Flash sp={sp} />
      <Table head={["강사", "계정", "공개 강의", "심사 중", "평균 평점", "상태"]} empty={rows.length === 0}>
        {rows.map((i) => {
          const pub = i.courses.filter((c) => c.status === "published");
          const rated = pub.filter((c) => c.rating_count > 0);
          const avg = rated.length ? rated.reduce((a, c) => a + c.rating_avg * c.rating_count, 0) / rated.reduce((a, c) => a + c.rating_count, 0) : 0;
          return (
            <tr key={i.id} className="hover:bg-slate-50">
              <Td>
                <Link href={`/admin/instructors/${i.id}`} className="flex items-center gap-2 font-medium text-brand-700 hover:underline">
                  <InstructorAvatar slug={i.slug} name={i.display_name} size={28} />
                  {i.display_name}
                </Link>
              </Td>
              <Td className="text-slate-500">{i.users.map((u) => u.email).join(", ") || "-"}</Td>
              <Td className="tabular-nums">{pub.length}</Td>
              <Td className="tabular-nums">{i.courses.filter((c) => c.status === "in_review").length}</Td>
              <Td className="tabular-nums">{avg ? avg.toFixed(2) : "-"}</Td>
              <Td>{i.status === "active" ? <Pill tone="green">활동 중</Pill> : <Pill tone="red">활동 멈춤</Pill>} <DemoBadge className="ml-1" /></Td>
            </tr>
          );
        })}
      </Table>
    </>
  );
}
