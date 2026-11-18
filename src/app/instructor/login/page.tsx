import type { Metadata } from "next";
import { AreaLoginForm } from "@/components/AuthForms";
import { Logo } from "@/components/Logo";

export const metadata: Metadata = { title: "강사 로그인" };

export default async function InstructorLogin({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm">
        <Logo />
        <h1 className="mt-4 text-xl font-bold">강사 로그인</h1>
        <p className="mb-6 mt-1 text-sm text-slate-500">스터디온에듀 강사 화면이에요. 시연용 가상 강사 계정으로 들어와요.</p>
        <AreaLoginForm area="instructor" next={next} />
      </div>
    </div>
  );
}
