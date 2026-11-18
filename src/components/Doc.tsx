/** 약관·방침 같은 긴 글 틀. */
export function Doc({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-1 text-sm text-slate-500">시행일 {updated} · 시연용 가상 서비스 스터디온에듀</p>
      <div className="mt-8 space-y-6 text-[15px] leading-7 text-slate-800 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-bold [&_li]:ml-5 [&_ol]:list-decimal [&_ul]:list-disc">
        {children}
      </div>
    </article>
  );
}
