import { PaySuccess } from "@/components/PaySuccess";

export const dynamic = "force-dynamic";

export default async function PaySuccessPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ok = sp.orderId && sp.paymentKey && sp.amount;
  return (
    <div className="mx-auto max-w-md px-4 py-20">
      {ok ? (
        <PaySuccess orderId={sp.orderId!} paymentKey={sp.paymentKey!} amount={Number(sp.amount)} />
      ) : (
        <p className="text-center text-slate-600">결제 정보가 없어요. 주문 내역에서 다시 시도해 주세요.</p>
      )}
    </div>
  );
}
