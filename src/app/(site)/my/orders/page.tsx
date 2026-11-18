import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ORDER_STATUS_LABEL, dateTimeKo, won } from "@/lib/format";
import { currentUser } from "@/server/auth/current";
import { listOrdersForUser } from "@/server/orders";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "주문·환불" };

export default async function MyOrdersPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/my/orders");
  const orders = await listOrdersForUser(user.id);
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <p className="text-sm"><Link href="/my" className="text-brand-600 hover:underline">마이페이지</Link></p>
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight">주문·환불</h1>
      {orders.length === 0 ? (
        <p className="mt-6 rounded-2xl bg-white p-8 text-center text-sm text-slate-600 ring-1 ring-slate-200">주문한 적이 없어요.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {orders.map((o) => (
            <li key={o.id} className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <Link href={`/my/orders/${o.code}`} className="font-mono font-semibold hover:text-brand-700">{o.code}</Link>
                <span className="badge">{ORDER_STATUS_LABEL[o.status] ?? o.status}</span>
              </div>
              <p className="mt-1 line-clamp-1 text-sm text-slate-700">
                {o.items[0]?.course?.title ?? o.items[0]?.bundle?.title}
                {o.items.length > 1 ? ` 외 ${o.items.length - 1}건` : ""}
              </p>
              <p className="mt-1 flex justify-between text-xs text-slate-500">
                <span>{dateTimeKo((o.paid_at ?? o.created_at).toISOString())}</span>
                <span className="price text-sm text-ink">{won(o.payable)}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
