import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { InboxList } from "@/components/InboxList";
import { currentUser } from "@/server/auth/current";
import { inboxView, listInbox } from "@/server/inbox";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "메시지함" };

/** 메시지함: 쿠폰 도착·안내. */
export default async function InboxPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/my/inbox");
  const rows = await listInbox(user.id);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-sm"><Link href="/my" className="text-brand-600 hover:underline">마이페이지</Link></p>
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight">메시지함</h1>
      <InboxList items={rows.map(inboxView)} />
    </div>
  );
}
