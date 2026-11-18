import type { Metadata } from "next";
import { SignupForm } from "@/components/AuthForms";

export const metadata: Metadata = { title: "회원가입" };

export default function SignupPage() {
  return (
    <div className="mx-auto max-w-sm px-4 py-14">
      <h1 className="text-2xl font-bold">회원가입</h1>
      <p className="mb-6 mt-1 text-sm text-slate-600">회원이면 강의를 사고, 진도를 이어 보고, 수료증을 받을 수 있어요.</p>
      <SignupForm />
    </div>
  );
}
