import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { InquiryForm } from "@/components/InquiryForm";
import { currentUser } from "@/server/auth/current";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "1:1 문의" };

export default async function InquiryPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/support/inquiry");
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <p className="text-sm"><Link href="/support" className="text-brand-600 hover:underline">고객센터</Link></p>
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight">1:1 문의</h1>
      <p className="mt-2 text-sm text-slate-600">먼저 <Link href="/support/faq" className="font-semibold text-brand-700 underline">자주 묻는 질문</Link>을 확인해 보세요. 답변은 <Link href="/my/inquiries" className="font-semibold text-brand-700 underline">내 문의</Link>와 메일로 알려 드려요.</p>
      <InquiryForm />
    </div>
  );
}
