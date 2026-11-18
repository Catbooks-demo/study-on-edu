import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/AuthForms";
import { currentStaff } from "@/server/auth/current";

export const dynamic = "force-dynamic";

/** 임시 직원 첫 화면. 대시보드는 Task 19에서 만든다. */
export default async function AdminHome() {
  const staff = await currentStaff();
  if (!staff) redirect("/admin/login");
  return (
    <div className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="text-2xl font-bold">운영 화면</h1>
      <p className="mt-2 text-slate-600">{staff.name} 님({staff.role})으로 로그인했어요.</p>
      <div className="mt-6"><LogoutButton area="admin" /></div>
    </div>
  );
}
