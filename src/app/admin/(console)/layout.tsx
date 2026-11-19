import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LogoutButton } from "@/components/AuthForms";
import { Logo } from "@/components/Logo";
import { currentStaff } from "@/server/auth/current";
import { can } from "@/server/roles";
import { NAV } from "./nav";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { default: "운영", template: "%s | 스터디온에듀 운영" }, robots: { index: false } };

const ROLE_KO: Record<string, string> = { admin: "관리자", cs: "고객 지원", content: "콘텐츠" };

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const staff = await currentStaff();
  if (!staff) redirect("/admin/login");
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.perm || can(staff.role, i.perm)) })).filter((g) => g.items.length);
  return (
    <div className="flex min-h-screen bg-slate-100 text-ink">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col overflow-y-auto bg-ink px-3 py-5 text-sm text-slate-300 md:flex">
        <Link href="/admin" aria-label="스터디온에듀 운영" className="flex flex-col items-start gap-1 px-2">
          <span className="rounded-md bg-white px-2 py-1"><Logo className="[&_img]:h-7" /></span>
          <span className="text-xs font-semibold text-brand-300">운영</span>
        </Link>
        <nav aria-label="운영 메뉴" className="mt-6 flex-1 space-y-4">
          {groups.map((g) => (
            <div key={g.label}>
              <p className="px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{g.label}</p>
              <ul className="mt-1 space-y-0.5">
                {g.items.map((m) => (
                  <li key={m.href}>
                    <Link href={m.href} className="block rounded-md px-2 py-1.5 hover:bg-white/10 hover:text-white">{m.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="mt-4 border-t border-white/10 px-2 pt-3">
          <p className="text-white">{staff.name}</p>
          <p className="text-xs text-slate-400">{ROLE_KO[staff.role] ?? staff.role} · {staff.email}</p>
          <div className="mt-2 flex items-center gap-3 [&_button]:text-xs [&_button]:text-slate-400">
            <Link href="/" className="text-xs text-slate-400 hover:text-white">수강생 화면</Link>
            <LogoutButton area="admin" />
          </div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <nav aria-label="운영 메뉴 (모바일)" className="flex gap-3 overflow-x-auto bg-ink px-4 py-2 text-sm text-slate-200 md:hidden">
          {groups.flatMap((g) => g.items).map((m) => <Link key={m.href} href={m.href} className="whitespace-nowrap">{m.label}</Link>)}
        </nav>
        <main className="mx-auto max-w-6xl p-5">{children}</main>
      </div>
    </div>
  );
}
