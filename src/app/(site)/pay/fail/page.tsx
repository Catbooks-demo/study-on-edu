import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function PayFailPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const canceled = sp.code === "PAY_PROCESS_CANCELED";
  const order = sp.order && /^SO\d{10}$/.test(sp.order) ? sp.order : null;
  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      <p className="text-lg font-semibold">{canceled ? "결제를 취소했어요" : "결제하지 못했어요"}</p>
      {!canceled && sp.message && <p className="mt-2 text-sm text-slate-600">{sp.message.slice(0, 200)}</p>}
      <p className="mt-2 text-sm text-slate-500">주문은 30분 동안 남아 있어요. 그 안에 다시 결제해 주세요.</p>
      <Link href={order ? `/checkout/${order}` : "/cart"} className="btn-primary mt-6">주문서로 돌아가기</Link>
    </div>
  );
}
