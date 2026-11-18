import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/AuthForms";
import { currentStaff } from "@/server/auth/current";
import { can } from "@/server/roles";

export const dynamic = "force-dynamic";

const MENU = [
  { href: "/admin/ops", label: "운영 개요" },
  { href: "/admin/ops/incidents", label: "장애 공지" },
  { href: "/admin/ops/mode", label: "서비스 모드" },
  { href: "/admin/ops/queue", label: "대기열" },
  { href: "/admin/webhooks", label: "웹훅" },
] as const;

/** 운영 화면 공통 틀 (admin만: 대기열·서비스 모드·장애 공지·지표). */
export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const staff = await currentStaff();
  if (!staff) redirect("/admin/login?next=/admin/ops");
  if (!can(staff.role, "ops")) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-14">
        <h1 className="text-xl font-bold">운영 화면은 관리자만 볼 수 있어요.</h1>
        <p className="mt-2 text-sm text-slate-600">{staff.name} 님({staff.role}) 권한으로는 열 수 없어요.</p>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          <Link href="/admin" className="hover:underline">운영 화면</Link> › 운영
        </p>
        <LogoutButton area="admin" />
      </div>
      <nav aria-label="운영 메뉴" className="mt-3 flex flex-wrap gap-1 border-b border-slate-200 pb-2 text-sm">
        {MENU.map((m) => (
          <Link key={m.href} href={m.href} className="rounded-md px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100">
            {m.label}
          </Link>
        ))}
      </nav>
      <div className="mt-6">{children}</div>
    </div>
  );
}
