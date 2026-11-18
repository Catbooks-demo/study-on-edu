import type { Staff } from "@prisma/client";
import { redirect } from "next/navigation";
import { currentStaff } from "@/server/auth/current";
import { type Perm, can } from "@/server/roles";

/** 화면 권한 확인. 로그인하지 않았으면 로그인 화면, 권한이 없으면 대시보드로 보내고 이유를 띄운다. */
export async function guard(perm: Perm | null): Promise<Staff> {
  const st = await currentStaff();
  if (!st) redirect("/admin/login");
  if (perm && !can(st.role, perm)) redirect(`/admin?err=${encodeURIComponent("이 화면은 권한이 없어요. 관리자에게 요청해 주세요.")}`);
  return st;
}

export type SP = Promise<Record<string, string | undefined>>;

/** 쪽 번호 (1부터). */
export const pageOf = (v: string | undefined) => Math.max(1, Math.min(10_000, Number(v) || 1));

/** 현재 검색 조건을 유지한 채 값 하나를 바꾼 주소. */
export function hrefWith(path: string, sp: Record<string, string | undefined>, patch: Record<string, string | number | undefined>) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch })) {
    if (k === "ok" || k === "err" || v === undefined || v === "") continue;
    q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}
