import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Logo } from "@/components/Logo";

/** 수강생 화면 공통 틀. 검색·카테고리·배너 자리는 Task 5에서 채운다. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Link href="/" aria-label="스터디온에듀 처음으로"><Logo /></Link>
          <nav className="flex gap-4 text-sm text-slate-600">
            <Link href="/login">로그인</Link>
            <Link href="/signup" className="font-semibold text-brand-600">회원가입</Link>
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
