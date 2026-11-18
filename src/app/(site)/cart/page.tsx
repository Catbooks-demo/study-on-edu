import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CartView } from "@/components/CartView";
import { currentUser } from "@/server/auth/current";
import { getCart } from "@/server/cart";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "장바구니" };

export default async function CartPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/cart");
  const { lines, pricing } = await getCart(user.id);
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="mb-6 text-2xl font-extrabold tracking-tight">장바구니</h1>
      <CartView
        lines={lines.map((l) => ({
          key: l.key, kind: l.kind, title: l.title, category: l.category, instructor_name: l.instructor_name, list: l.list, unit: l.unit, on_sale: l.on_sale,
        }))}
        listTotal={pricing.list_total}
        discountTotal={pricing.discount_total}
        payable={pricing.payable}
      />
    </div>
  );
}
