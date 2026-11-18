import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Logo } from "@/components/Logo";

/** 임시 메인. 카탈로그 화면은 Task 5에서 채운다. */
export default function Home() {
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
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-16">
        <h1 className="text-3xl font-extrabold tracking-tight">배움이 켜지는 곳, 스터디온에듀</h1>
        <p className="mt-3 text-slate-600">개발·데이터·자격증·어학·디자인·비즈니스·수능 강의를 준비하고 있어요.</p>
      </main>
      <Footer />
    </div>
  );
}
