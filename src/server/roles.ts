/** 직원 권한표. 화면·API는 requireStaff(req, perm)로 확인한다. */
export type StaffRole = "admin" | "cs" | "content";

export type Perm =
  | "catalog" // 강의·패키지·구독 플랜·쿠폰
  | "review_courses" // 강의 심사
  | "orders"
  | "refunds"
  | "subscriptions"
  | "students"
  | "instructors" // 강사 보기
  | "settlements" // 정산 확정
  | "live"
  | "support" // 문의·질문·후기·보낸 편지함
  | "content_pages" // 공지·FAQ
  | "ops" // 대기열·서비스 모드·장애 공지·지표
  | "staff"
  | "api_keys"
  | "audit";

export const STAFF_ROLES: readonly StaffRole[] = ["admin", "cs", "content"];

const TABLE: Record<Exclude<StaffRole, "admin">, readonly Perm[]> = {
  cs: ["orders", "refunds", "subscriptions", "students", "support"],
  content: ["review_courses", "catalog", "live", "content_pages", "instructors"],
};

export function isStaffRole(v: string): v is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(v);
}

/** admin은 모두, 나머지는 권한표대로. 정산·운영·직원·API 키·작업 기록은 admin만. */
export function can(role: StaffRole | string, perm: Perm): boolean {
  if (role === "admin") return true;
  if (role === "cs" || role === "content") return TABLE[role].includes(perm);
  return false;
}
