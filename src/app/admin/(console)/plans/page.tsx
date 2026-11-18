import { planEditAction } from "@/app/admin/actions";
import { Card, Flash, PageTitle } from "@/components/admin/ui";
import { won } from "@/lib/format";
import { db } from "@/server/db";
import { type SP, guard } from "../guard";

export const metadata = { title: "구독 플랜" };

export default async function Plans({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await guard("catalog");
  const [plans, counts] = await Promise.all([
    db.plan.findMany({ orderBy: { price: "asc" } }),
    db.subscription.groupBy({ by: ["plan_id"], where: { status: { in: ["active", "past_due", "paused"] } }, _count: { _all: true } }),
  ]);
  const alive = new Map(counts.map((c) => [c.plan_id, c._count._all]));
  return (
    <>
      <PageTitle title="구독 플랜" sub="가격을 바꾸면 다음 갱신 청구부터 새 가격이에요. 환불 기준 시간은 구독 환불의 시청 공제에 써요." />
      <Flash sp={sp} />
      <div className="grid gap-4 md:grid-cols-2">
        {plans.map((p) => (
          <Card key={p.id}>
            <p className="font-mono text-xs text-slate-500">{p.code} · {p.interval === "year" ? "연" : "월"} 단위 · 이용 중 {alive.get(p.id) ?? 0}명</p>
            <h2 className="text-lg font-bold">{p.name} <span className="text-base font-semibold text-slate-500">{won(p.price)}</span></h2>
            <form action={planEditAction} className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <input type="hidden" name="code" value={p.code} />
              <div><label htmlFor={`price-${p.id}`} className="label">가격 (원)</label><input id={`price-${p.id}`} name="price" inputMode="numeric" defaultValue={p.price} className="field" /></div>
              <div><label htmlFor={`h-${p.id}`} className="label">환불 기준 시간</label><input id={`h-${p.id}`} name="refund_base_hours" inputMode="numeric" defaultValue={p.refund_base_hours} className="field" /></div>
              <label className="col-span-2 flex items-center gap-2"><input type="checkbox" name="active" defaultChecked={p.active} /> 새 가입 받기</label>
              <button className="btn-line col-span-2">저장</button>
            </form>
          </Card>
        ))}
      </div>
    </>
  );
}
