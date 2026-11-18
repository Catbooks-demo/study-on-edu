import type { Metadata } from "next";
import Link from "next/link";
import { FAQ_CATEGORIES, listFaqs } from "@/server/support";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "자주 묻는 질문" };

type SP = Record<string, string | string[] | undefined>;

export default async function FaqPage({ searchParams }: { searchParams: Promise<SP> }) {
  const raw = (await searchParams).category;
  const category = typeof raw === "string" && raw in FAQ_CATEGORIES ? raw : undefined;
  const faqs = await listFaqs(category);
  const used = ["refund", "subscription", "device", "certificate", "live"];
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-extrabold tracking-tight">자주 묻는 질문</h1>
      <nav aria-label="FAQ 분류" className="mt-5 flex flex-wrap gap-2 text-sm">
        <Link href="/support/faq" className={`rounded-full px-3 py-1.5 font-semibold ring-1 ${!category ? "bg-brand-500 text-white ring-brand-500" : "bg-white ring-slate-200"}`}>전체</Link>
        {used.map((c) => (
          <Link key={c} href={`/support/faq?category=${c}`} className={`rounded-full px-3 py-1.5 font-semibold ring-1 ${category === c ? "bg-brand-500 text-white ring-brand-500" : "bg-white ring-slate-200"}`}>
            {FAQ_CATEGORIES[c]}
          </Link>
        ))}
      </nav>
      <dl className="mt-6 divide-y divide-slate-200 rounded-2xl bg-white ring-1 ring-slate-200">
        {faqs.map((f) => (
          <div key={f.id} id={`f-${f.id}`} className="scroll-mt-32 px-5 py-4">
            <dt className="font-semibold"><span className="mr-2 text-xs font-bold text-brand-600">{FAQ_CATEGORIES[f.category] ?? "기타"}</span>Q. {f.question}</dt>
            <dd className="mt-1.5 text-sm leading-6 text-slate-700">{f.answer}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
