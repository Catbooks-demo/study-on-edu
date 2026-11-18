import type { Metadata } from "next";
import Link from "next/link";
import { listFaqs, listNotices } from "@/server/support";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "고객센터" };

export default async function SupportPage() {
  const [notices, faqs] = await Promise.all([listNotices(4), listFaqs()]);
  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-2xl font-extrabold tracking-tight">고객센터</h1>
      <p className="mt-1 text-sm text-slate-500">궁금한 점을 먼저 FAQ에서 찾아보세요. 1:1 문의는 곧 열려요.</p>
      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">공지사항</h2>
            <Link href="/support/notices" className="text-sm font-semibold text-brand-600 hover:underline">전체</Link>
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            {notices.map((n) => (
              <li key={n.id}><Link href={`/support/notices#n-${n.id}`} className="line-clamp-1 hover:text-brand-700">{n.title}</Link></li>
            ))}
          </ul>
        </section>
        <section className="rounded-2xl bg-white p-5 ring-1 ring-slate-200">
          <div className="flex items-center justify-between">
            <h2 className="font-bold">자주 묻는 질문</h2>
            <Link href="/support/faq" className="text-sm font-semibold text-brand-600 hover:underline">전체</Link>
          </div>
          <ul className="mt-3 space-y-2 text-sm">
            {faqs.slice(0, 5).map((f) => (
              <li key={f.id}><Link href={`/support/faq#f-${f.id}`} className="line-clamp-1 hover:text-brand-700">Q. {f.question}</Link></li>
            ))}
          </ul>
        </section>
      </div>
      <section className="mt-5 grid gap-3 sm:grid-cols-3">
        {[
          ["/terms/service", "이용약관"],
          ["/terms/privacy", "개인정보 처리방침"],
          ["/terms/refund", "환불 규정"],
        ].map(([href, label]) => (
          <Link key={href} href={href} className="rounded-2xl bg-white px-5 py-4 text-sm font-semibold ring-1 ring-slate-200 hover:ring-brand-300">{label} ›</Link>
        ))}
      </section>
    </div>
  );
}
