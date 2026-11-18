import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { dateTimeKo } from "@/lib/format";
import { currentUser } from "@/server/auth/current";
import { INQUIRY_CATEGORY_LABEL, type InquiryCategory, listMyInquiries } from "@/server/inquiries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "내 문의" };

export default async function MyInquiriesPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/my/inquiries");
  const items = await listMyInquiries(user.id);
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-sm"><Link href="/my" className="text-brand-600 hover:underline">마이페이지</Link></p>
      <div className="mt-1 flex items-end justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">내 1:1 문의</h1>
        <Link href="/support/inquiry" className="btn-primary px-3 py-1.5 text-sm">문의하기</Link>
      </div>
      {items.length === 0 && <p className="mt-6 rounded-2xl bg-white p-8 text-center text-sm text-slate-600 ring-1 ring-slate-200">문의한 내역이 없어요.</p>}
      <ul className="mt-6 space-y-3">
        {items.map((q) => (
          <li key={q.id} className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <span className="badge">{INQUIRY_CATEGORY_LABEL[q.category as InquiryCategory] ?? q.category}</span>
              <span className="font-semibold">{q.title}</span>
              <span className={`badge ml-auto ${q.status === "answered" ? "bg-brand-50 text-brand-700 ring-brand-200" : ""}`}>{q.status === "answered" ? "답변 완료" : "답변 대기"}</span>
            </p>
            <p className="mt-1 text-xs text-slate-500">{dateTimeKo(q.created_at.toISOString())}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm">{q.body}</p>
            {q.answer && (
              <div className="mt-3 rounded-xl bg-brand-50 p-3 text-sm">
                <p className="text-xs font-semibold text-brand-700">운영팀 답변 · {q.answered_at ? dateTimeKo(q.answered_at.toISOString()) : ""}</p>
                <p className="mt-1 whitespace-pre-wrap">{q.answer}</p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
