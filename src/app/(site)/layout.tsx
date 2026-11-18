import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Logo } from "@/components/Logo";
import { currentUser } from "@/server/auth/current";
import { listCategories } from "@/server/catalog";

export const dynamic = "force-dynamic";

/** 수강생 화면 공통 틀: 헤더(검색·메뉴·분야), 배너 자리, 푸터. */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const [user, categories] = await Promise.all([currentUser(), listCategories()]);
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link href="/" aria-label="스터디온에듀 처음으로" className="shrink-0"><Logo /></Link>
          <form action="/courses" role="search" className="hidden flex-1 md:block">
            <label htmlFor="site-search" className="sr-only">강의 검색</label>
            <input
              id="site-search"
              name="q"
              type="search"
              maxLength={50}
              placeholder="배우고 싶은 것을 찾아보세요"
              className="w-full max-w-md rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-100"
            />
          </form>
          <nav aria-label="주 메뉴" className="ml-auto flex items-center gap-1 text-sm text-slate-600">
            <Link href="/courses" className="rounded-md px-2.5 py-1.5 hover:bg-slate-100">전체 강의</Link>
            <Link href="/bundles" className="hidden rounded-md px-2.5 py-1.5 hover:bg-slate-100 sm:inline">패키지</Link>
            <Link href="/subscribe" className="hidden rounded-md px-2.5 py-1.5 font-semibold text-brand-700 hover:bg-brand-50 sm:inline">구독</Link>
            <Link href="/support" className="hidden rounded-md px-2.5 py-1.5 hover:bg-slate-100 lg:inline">고객센터</Link>
            {user ? (
              <span className="rounded-md px-2.5 py-1.5 font-medium text-brand-700">{user.name}님</span>
            ) : (
              <>
                <Link href="/login" className="rounded-md px-2.5 py-1.5 hover:bg-slate-100">로그인</Link>
                <Link href="/signup" className="btn-primary ml-1 hidden px-3 py-1.5 sm:inline-flex">회원가입</Link>
              </>
            )}
          </nav>
        </div>
        <nav aria-label="카테고리" className="mx-auto max-w-6xl overflow-x-auto px-4">
          <ul className="flex gap-5 whitespace-nowrap pb-2 text-[15px] font-semibold text-slate-700">
            {categories.map((c) => (
              <li key={c.code}>
                <Link href={`/courses?category=${c.code}`} className="inline-block border-b-2 border-transparent py-1 hover:border-brand-500 hover:text-brand-700">
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      {/* 서비스 모드·장애 공지 배너 자리 (Task 20–21) */}
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
