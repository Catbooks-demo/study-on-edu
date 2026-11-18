import type { Perm } from "@/server/roles";

/** 직원 화면 메뉴. 권한(perm)이 없으면 메뉴에 보이지 않는다(화면·API에서 다시 확인한다). */
export type NavItem = { href: string; label: string; perm: Perm | null };
export type NavGroup = { label: string; items: NavItem[] };

export const NAV: NavGroup[] = [
  { label: "한눈에", items: [{ href: "/admin", label: "대시보드", perm: null }] },
  {
    label: "강의·상품",
    items: [
      { href: "/admin/reviews-queue", label: "강의 심사", perm: "review_courses" },
      { href: "/admin/courses", label: "강의", perm: "catalog" },
      { href: "/admin/bundles", label: "패키지", perm: "catalog" },
      { href: "/admin/plans", label: "구독 플랜", perm: "catalog" },
      { href: "/admin/coupons", label: "쿠폰", perm: "catalog" },
      { href: "/admin/live", label: "라이브", perm: "live" },
    ],
  },
  {
    label: "주문·회원",
    items: [
      { href: "/admin/orders", label: "주문·결제", perm: "orders" },
      { href: "/admin/refunds", label: "환불", perm: "refunds" },
      { href: "/admin/subscriptions", label: "구독", perm: "subscriptions" },
      { href: "/admin/students", label: "수강생", perm: "students" },
    ],
  },
  {
    label: "강사",
    items: [
      { href: "/admin/instructors", label: "강사", perm: "instructors" },
      { href: "/admin/settlements", label: "정산", perm: "settlements" },
    ],
  },
  {
    label: "소통",
    items: [
      { href: "/admin/inquiries", label: "1:1 문의", perm: "support" },
      { href: "/admin/questions", label: "강의 질문", perm: "support" },
      { href: "/admin/reviews", label: "후기", perm: "support" },
      { href: "/admin/notices", label: "공지", perm: "content_pages" },
      { href: "/admin/faqs", label: "FAQ", perm: "content_pages" },
      { href: "/admin/messages", label: "보낸 편지함", perm: "support" },
    ],
  },
  {
    // 운영(대기열·서비스 모드·장애 공지·지표)과 웹훅 화면은 M7(/admin/ops, /admin/webhooks)이 채운다
    label: "운영",
    items: [
      { href: "/admin/ops", label: "운영 개요", perm: "ops" },
      { href: "/admin/ops/incidents", label: "장애 공지", perm: "ops" },
      { href: "/admin/ops/mode", label: "서비스 모드", perm: "ops" },
      { href: "/admin/ops/queue", label: "대기열", perm: "ops" },
      { href: "/admin/webhooks", label: "웹훅", perm: "api_keys" },
    ],
  },
  {
    label: "관리자",
    items: [
      { href: "/admin/staff", label: "직원", perm: "staff" },
      { href: "/admin/api-keys", label: "API 키", perm: "api_keys" },
      { href: "/admin/audit", label: "작업 기록", perm: "audit" },
    ],
  },
];
