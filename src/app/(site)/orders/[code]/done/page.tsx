import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { won } from "@/lib/format";
import { currentUser } from "@/server/auth/current";
import { HttpError } from "@/server/http";
import { getOrderForUser } from "@/server/orders";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "결제 완료" };

export default async function OrderDonePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=/orders/${encodeURIComponent(code)}/done`);
  const order = await getOrderForUser(user.id, code).catch((e) => {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  });
  if (order.status === "pending") redirect(`/checkout/${order.code}`);
  const paid = order.status !== "cancelled";
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-brand-50 text-2xl text-brand-600" aria-hidden>{paid ? "✓" : "!"}</div>
      <h1 className="mt-4 text-2xl font-extrabold">{paid ? "결제가 완료됐어요" : "취소된 주문이에요"}</h1>
      <p className="mt-2 text-slate-600">
        주문번호 <span data-testid="order-code" className="font-mono font-semibold text-ink">{order.code}</span>
      </p>
      {paid && (
        <>
          <ul className="mx-auto mt-6 max-w-sm divide-y divide-slate-100 rounded-2xl bg-white text-left text-sm ring-1 ring-slate-200">
            {order.items.map((it) => (
              <li key={it.id} className="flex justify-between gap-3 px-4 py-3">
                <span className="min-w-0 truncate">{it.course?.title ?? it.bundle?.title}</span>
                <span className="price shrink-0">{won(it.paid_amount)}</span>
              </li>
            ))}
            <li className="flex justify-between px-4 py-3 font-bold"><span>결제 금액</span><span className="price">{won(order.payable)}</span></li>
          </ul>
          <p className="mt-3 text-sm text-slate-500">내 강의실에서 바로 들을 수 있어요. 안내 메일은 보낸 편지함에 남겨 뒀어요.</p>
        </>
      )}
      <div className="mt-6 flex justify-center gap-2">
        <Link href="/my" className="btn-primary">내 강의실</Link>
        <Link href={`/my/orders/${order.code}`} className="btn-line">주문 상세</Link>
      </div>
    </div>
  );
}
