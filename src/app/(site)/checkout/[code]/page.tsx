import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { CheckoutForm } from "@/components/CheckoutForm";
import { dateTimeKo } from "@/lib/format";
import { currentUser } from "@/server/auth/current";
import { myCoupons } from "@/server/couponbox";
import { tossEnabled } from "@/server/env";
import { HttpError } from "@/server/http";
import { getOrderForUser, orderView } from "@/server/orders";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "주문서" };

export default async function CheckoutPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=/checkout/${encodeURIComponent(code)}`);
  const order = await getOrderForUser(user.id, code).catch((e) => {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  });
  if (order.status !== "pending") redirect(`/my/orders/${order.code}`);
  const v = orderView(order);
  const expired = order.expires_at <= new Date();
  const box = (await myCoupons(user.id)).filter((c) => c.state === "usable").map((c) => ({ code: c.code, name: c.name, discount: c.discount }));
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-extrabold tracking-tight">주문서</h1>
      <p className="mb-6 mt-1 text-sm text-slate-500">
        주문번호 {v.code} · {dateTimeKo(v.expires_at)}까지 결제해 주세요.
      </p>
      {expired ? (
        <div className="rounded-2xl bg-white p-8 text-center ring-1 ring-slate-200">
          <p className="font-semibold">결제 기한(30분)이 지난 주문이에요.</p>
          <Link href="/courses" className="btn-primary mt-4">강의 다시 담기</Link>
        </div>
      ) : (
        <CheckoutForm order={v} toss={tossEnabled()} boxCoupons={box} />
      )}
    </div>
  );
}
