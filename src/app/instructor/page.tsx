import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/AuthForms";
import { currentInstructor } from "@/server/auth/current";

export const dynamic = "force-dynamic";

/** 임시 강사 첫 화면. 대시보드는 Task 18에서 만든다. */
export default async function InstructorHome() {
  const me = await currentInstructor();
  if (!me) redirect("/instructor/login");
  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-2xl font-bold">강사 화면</h1>
      <p className="mt-2 text-slate-600">
        {me.instructor.display_name} 님으로 로그인했어요. <span className="badge bg-lemon-300/40 text-ink ring-lemon-500">시연용 가상 강사</span>
      </p>
      <div className="mt-6"><LogoutButton area="instructor" /></div>
    </div>
  );
}
