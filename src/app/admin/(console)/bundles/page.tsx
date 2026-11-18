import { bundleEditAction } from "@/app/admin/actions";
import { Card, Flash, PageTitle } from "@/components/admin/ui";
import { accessLabel, discountPct, won } from "@/lib/format";
import { db } from "@/server/db";
import { type SP, guard } from "../guard";

export const metadata = { title: "패키지" };

export default async function Bundles({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await guard("catalog");
  const rows = await db.bundle.findMany({
    include: { courses: { orderBy: { sort: "asc" }, include: { course: { select: { code: true, title: true, price: true, instructor: { select: { display_name: true } } } } } }, _count: { select: { order_items: true } } },
    orderBy: { code: "asc" },
  });
  return (
    <>
      <PageTitle title="패키지" sub="패키지 판매분은 정산 때 묶음 강의의 정가 비율로 강사에게 나눠요." />
      <Flash sp={sp} />
      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map((b) => {
          const list = b.courses.reduce((a, bc) => a + bc.course.price, 0);
          return (
            <Card key={b.id}>
              <p className="font-mono text-xs text-slate-500">{b.code} · 판매 {b._count.order_items}건 · {accessLabel(b.access_days)}</p>
              <h2 className="font-bold">{b.title}</h2>
              <ul className="mt-2 text-sm text-slate-600">
                {b.courses.map((bc) => (
                  <li key={bc.course.code} className="flex justify-between gap-2"><span className="truncate">{bc.course.title} · {bc.course.instructor.display_name}</span><span className="tabular-nums">{won(bc.course.price)}</span></li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-slate-500">정가 합 {won(list)} → 패키지 {won(b.price)} ({discountPct(list, b.price)}% 할인)</p>
              <form action={bundleEditAction} className="mt-3 flex flex-wrap items-end gap-2 text-sm">
                <input type="hidden" name="code" value={b.code} />
                <div><label htmlFor={`p-${b.id}`} className="label">가격</label><input id={`p-${b.id}`} name="price" inputMode="numeric" defaultValue={b.price} className="field w-32" /></div>
                <label className="flex items-center gap-2 pb-2"><input type="checkbox" name="active" defaultChecked={b.active} /> 판매 중</label>
                <button className="btn-line px-3 py-2">저장</button>
              </form>
            </Card>
          );
        })}
      </div>
    </>
  );
}
