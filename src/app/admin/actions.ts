"use server";

import type { Staff } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { kstDateTime } from "@/rules/time";
import { approveCourse, rejectCourse, setCourseHidden, setInstructorStatus, updateCourse } from "@/server/admin";
import { NEW_KEY_COOKIE, SCOPES, type Scope, issueApiKey, revokeApiKey } from "@/server/apikeys";
import { audit } from "@/server/audit";
import { currentStaff } from "@/server/auth/current";
import { privateData } from "@/server/couponbox";
import { hashPassword } from "@/server/auth/password";
import { db } from "@/server/db";
import { revokeDevice } from "@/server/devices";
import { HttpError } from "@/server/http";
import { answerInquiry } from "@/server/inquiries";
import { attachReplay } from "@/server/live";
import { recordMessage } from "@/server/messages";
import { answerQuestion } from "@/server/qa";
import { approveRefund, rejectRefund } from "@/server/refunds";
import { hideReview } from "@/server/reviews";
import { type Perm, can, isStaffRole } from "@/server/roles";
import { computeMonth, confirmSettlement } from "@/server/settlements";
import { retryInvoiceNow } from "@/server/subscriptions";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const n = (f: FormData, k: string) => {
  const v = s(f, k).replace(/[^0-9-]/g, "");
  return v === "" ? undefined : Number(v);
};
const on = (f: FormData, k: string) => f.get(k) === "on" || f.get(k) === "true";

/** 돌아갈 화면: 폼의 back 값이 /admin 아래일 때만. */
const backOf = (f: FormData, fallback: string) => {
  const b = s(f, "back");
  return b.startsWith("/admin") && !b.startsWith("//") ? b : fallback;
};

const withQuery = (path: string, key: string, value: string) => {
  const [base, q = ""] = path.split("?");
  const sp = new URLSearchParams(q);
  sp.delete("ok");
  sp.delete("err");
  sp.set(key, value);
  return `${base}?${sp.toString()}`;
};

/**
 * 직원 확인 → 처리 → 같은 화면으로 돌아간다. 권한이 없거나 처리할 수 없으면 화면 위에 이유를 띄운다(?err=).
 * 모든 쓰기는 각 서비스나 여기서 감사 기록(audit)을 남긴다.
 */
async function act(back: string, perm: Perm | null, fn: (st: Staff) => Promise<string | void>): Promise<never> {
  const st = await currentStaff();
  if (!st) redirect("/admin/login");
  let msg: string | void;
  try {
    if (perm && !can(st.role, perm)) throw new HttpError(403, "FORBIDDEN", "이 작업은 권한이 없어요.");
    msg = await fn(st);
  } catch (e) {
    if (e instanceof HttpError) redirect(withQuery(back, "err", e.message));
    throw e;
  }
  revalidatePath(back.split("?")[0]);
  redirect(withQuery(back, "ok", msg || "처리했어요."));
}

// ── 강의 심사·강의 ──
export async function approveCourseAction(f: FormData) {
  await act(backOf(f, "/admin/reviews-queue"), "review_courses", async (st) => {
    const c = await approveCourse(st.id, s(f, "code"));
    return `「${c.title}」을 공개했어요.`;
  });
}

export async function rejectCourseAction(f: FormData) {
  await act(backOf(f, "/admin/reviews-queue"), "review_courses", async (st) => {
    await rejectCourse(st.id, s(f, "code"), s(f, "reason"));
    return "반려하고 강사에게 사유를 보냈어요.";
  });
}

export async function courseHideAction(f: FormData) {
  const code = s(f, "code");
  await act(`/admin/courses/${code}`, "catalog", async (st) => {
    const hide = s(f, "hidden") === "true";
    await setCourseHidden(st.id, code, hide);
    return hide ? "강의를 목록에서 숨겼어요. 이미 산 수강생은 계속 볼 수 있어요." : "강의를 다시 공개했어요.";
  });
}

export async function courseEditAction(f: FormData) {
  const code = s(f, "code");
  await act(`/admin/courses/${code}`, "catalog", async (st) => {
    const sale = n(f, "sale_price");
    const ends = s(f, "sale_ends_on");
    await updateCourse(st.id, code, {
      title: s(f, "title"),
      subtitle: s(f, "subtitle"),
      price: n(f, "price") ?? -1,
      sale_price: sale ?? null,
      sale_ends_at: /^\d{4}-\d{2}-\d{2}$/.test(ends) ? kstDateTime(ends, 23, 59, 59) : null,
      in_subscription: on(f, "in_subscription"),
    });
    return "강의 정보를 저장했어요.";
  });
}

// ── 패키지·플랜·쿠폰 ──
export async function bundleEditAction(f: FormData) {
  await act("/admin/bundles", "catalog", async (st) => {
    const price = n(f, "price");
    if (!price || price <= 0) throw new HttpError(400, "BAD_INPUT", "가격을 확인해 주세요.");
    const b = await db.bundle.update({ where: { code: s(f, "code") }, data: { price, active: on(f, "active") } });
    await audit(`staff:${st.id}`, "bundle.edit", `bundle:${b.code}`, { price, active: b.active });
    return `${b.title} 패키지를 저장했어요.`;
  });
}

export async function planEditAction(f: FormData) {
  await act("/admin/plans", "catalog", async (st) => {
    const price = n(f, "price");
    const hours = n(f, "refund_base_hours");
    if (!price || price <= 0 || !hours || hours <= 0) throw new HttpError(400, "BAD_INPUT", "가격과 환불 기준 시간을 확인해 주세요.");
    const p = await db.plan.update({ where: { code: s(f, "code") }, data: { price, refund_base_hours: hours, active: on(f, "active") } });
    await audit(`staff:${st.id}`, "plan.edit", `plan:${p.code}`, { price, refund_base_hours: hours, active: p.active });
    return `${p.name} 플랜을 저장했어요. 다음 갱신부터 새 가격이 적용돼요.`;
  });
}

export async function couponCreateAction(f: FormData) {
  await act("/admin/coupons", "catalog", async (st) => {
    const code = s(f, "code").toUpperCase();
    const kind = s(f, "kind") === "fixed" ? "fixed" : "percent";
    const value = n(f, "value");
    const starts = s(f, "starts_on");
    const ends = s(f, "ends_on");
    const target = ["all", "category", "course", "instructor"].includes(s(f, "target")) ? s(f, "target") : "all";
    if (!/^[A-Z0-9-]{3,30}$/.test(code)) throw new HttpError(400, "BAD_CODE", "쿠폰 번호는 영문 대문자·숫자·- 3~30자로 정해 주세요.");
    if (!value || value <= 0 || (kind === "percent" && value > 100)) throw new HttpError(400, "BAD_VALUE", "할인 값을 확인해 주세요.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(starts) || !/^\d{4}-\d{2}-\d{2}$/.test(ends) || ends < starts) {
      throw new HttpError(400, "BAD_DATE", "시작일과 마감일을 확인해 주세요.");
    }
    if (target !== "all" && !s(f, "target_ref")) throw new HttpError(400, "BAD_TARGET", "대상(분야 코드·강의 코드·강사 slug)을 적어 주세요.");
    if (await db.coupon.findUnique({ where: { code } })) throw new HttpError(409, "EXISTS", "이미 있는 쿠폰 번호예요.");
    const c = await db.coupon.create({
      data: {
        code,
        name: s(f, "name") || code,
        kind,
        value,
        max_discount: n(f, "max_discount") ?? null,
        min_amount: n(f, "min_amount") ?? null,
        target,
        target_ref: target === "all" ? null : s(f, "target_ref"),
        starts_at: kstDateTime(starts),
        ends_at: kstDateTime(ends, 23, 59, 59),
        ...privateData(on(f, "private"), on(f, "per_user_once")),
        total_limit: n(f, "total_limit") ?? null,
      },
    });
    await audit(`staff:${st.id}`, "coupon.create", `coupon:${c.code}`, { kind, value, target, private: c.private });
    return `${c.code} 쿠폰을 만들었어요.`;
  });
}

export async function couponToggleAction(f: FormData) {
  await act("/admin/coupons", "catalog", async (st) => {
    const c = await db.coupon.findUniqueOrThrow({ where: { id: s(f, "id") } });
    await db.coupon.update({ where: { id: c.id }, data: { active: !c.active } });
    await audit(`staff:${st.id}`, c.active ? "coupon.disable" : "coupon.enable", `coupon:${c.code}`);
    return c.active ? "쿠폰을 껐어요." : "쿠폰을 다시 켰어요.";
  });
}

// ── 환불 ──
export async function refundApproveAction(f: FormData) {
  const id = s(f, "id");
  await act(`/admin/refunds/${id}`, "refunds", async (st) => {
    const amount = n(f, "amount");
    const r = await approveRefund(id, st.id, { amount, reason: s(f, "reason") || undefined });
    return r.status === "done"
      ? `환불을 승인하고 ${r.amount.toLocaleString("ko-KR")}원을 돌려드렸어요.`
      : "환불을 승인했어요. 결제사 처리가 늦어 작업이 다시 시도해요.";
  });
}

export async function refundRejectAction(f: FormData) {
  const id = s(f, "id");
  await act(`/admin/refunds/${id}`, "refunds", async (st) => {
    await rejectRefund(id, st.id, s(f, "reason"));
    return "환불 신청을 거절하고 사유를 보냈어요.";
  });
}

// ── 구독·수강생 ──
export async function subscriptionRetryAction(f: FormData) {
  await act(backOf(f, "/admin/subscriptions"), "subscriptions", async (st) => {
    const sub = await retryInvoiceNow(`staff:${st.id}`, s(f, "id"));
    return sub.status === "active" ? "다시 결제해서 구독이 정상으로 돌아왔어요." : "다시 결제했지만 이번에도 실패했어요.";
  });
}

export async function deviceRevokeAction(f: FormData) {
  await act(backOf(f, "/admin/students"), "students", async (st) => {
    await revokeDevice({ kind: "staff", id: st.id }, s(f, "id"));
    return "기기를 해제했어요. 수강생이 새 기기를 등록할 수 있어요.";
  });
}

// ── 강사·정산 ──
export async function instructorStatusAction(f: FormData) {
  const id = s(f, "id");
  await act(`/admin/instructors/${id}`, "instructors", async (st) => {
    if (st.role !== "admin" && st.role !== "content") throw new HttpError(403, "FORBIDDEN", "이 작업은 권한이 없어요.");
    const to = s(f, "status") === "suspended" ? "suspended" : "active";
    await setInstructorStatus(st.id, id, to);
    return to === "suspended" ? "강사 활동을 멈췄어요. 강사 화면 로그인도 끊었어요." : "강사 활동을 다시 켰어요.";
  });
}

export async function settlementComputeAction(f: FormData) {
  const month = s(f, "month");
  await act(`/admin/settlements?month=${encodeURIComponent(month)}`, "settlements", async (st) => {
    const count = await computeMonth(month);
    await audit(`staff:${st.id}`, "settlement.compute", `month:${month}`, { count });
    return `${month} 정산을 다시 계산했어요 (강사 ${count}명). 확정한 정산은 그대로예요.`;
  });
}

export async function settlementConfirmAction(f: FormData) {
  await act(backOf(f, "/admin/settlements"), "settlements", async (st) => {
    const r = await confirmSettlement(st.id, s(f, "id"));
    return `정산을 확정했어요. 지급 예정일은 ${r.pay_date}이에요.`;
  });
}

// ── 라이브 ──
export async function liveCancelAction(f: FormData) {
  await act("/admin/live", "live", async (st) => {
    const why = s(f, "reason");
    if (!why) throw new HttpError(400, "REASON_REQUIRED", "취소 사유를 적어 주세요.");
    const live = await db.liveSession.findUniqueOrThrow({ where: { id: s(f, "id") }, include: { seats: { include: { user: true } } } });
    if (live.status !== "scheduled") throw new HttpError(409, "BAD_STATE", "예정인 라이브만 취소할 수 있어요.");
    await db.$transaction(async (tx) => {
      const changed = await tx.liveSession.updateMany({ where: { id: live.id, status: "scheduled" }, data: { status: "cancelled" } });
      if (changed.count !== 1) throw new HttpError(409, "BAD_STATE", "예정인 라이브만 취소할 수 있어요.");
      for (const seat of live.seats) {
        await recordMessage(tx, seat.user, "live_cancelled", "라이브 취소 안내", `예약하신 라이브 「${live.title}」이 취소됐어요. 사유: ${why}`);
      }
      await audit(`staff:${st.id}`, "live.cancel", `live:${live.id}`, { reason: why, seats: live.seats.length }, tx);
    });
    return `라이브를 취소하고 예약한 ${live.seats.length}명에게 알렸어요.`;
  });
}

export async function liveReplayAction(f: FormData) {
  await act("/admin/live", "live", async (st) => {
    const l = await attachReplay(`staff:${st.id}`, s(f, "id"), s(f, "section_id"));
    return `다시보기 강 「${l.title}」을 붙였어요.`;
  });
}

// ── 문의·질문·후기 ──
export async function inquiryAnswerAction(f: FormData) {
  await act(backOf(f, "/admin/inquiries"), "support", async (st) => {
    const answer = s(f, "answer");
    if (!answer) throw new HttpError(400, "EMPTY", "답변을 적어 주세요.");
    await answerInquiry(`staff:${st.id}`, s(f, "id"), answer.slice(0, 5000));
    return "답변을 보냈어요.";
  });
}

export async function questionAnswerAction(f: FormData) {
  await act(backOf(f, "/admin/questions"), "support", async (st) => {
    const body = s(f, "body");
    if (!body) throw new HttpError(400, "EMPTY", "답변을 적어 주세요.");
    await answerQuestion({ kind: "staff", id: st.id }, s(f, "id"), body.slice(0, 5000));
    await audit(`staff:${st.id}`, "question.answer", `question:${s(f, "id")}`);
    return "운영팀 이름으로 답변했어요.";
  });
}

export async function reviewHideAction(f: FormData) {
  await act(backOf(f, "/admin/reviews"), "support", async (st) => {
    const hidden = s(f, "hidden") === "true";
    await hideReview(st.id, s(f, "id"), hidden);
    return hidden ? "후기를 숨기고 평점을 다시 계산했어요." : "후기를 다시 보이게 했어요.";
  });
}

// ── 공지·FAQ ──
export async function noticeCreateAction(f: FormData) {
  await act("/admin/notices", "content_pages", async (st) => {
    const title = s(f, "title");
    const body = s(f, "body");
    if (!title || !body) throw new HttpError(400, "EMPTY", "제목과 내용을 적어 주세요.");
    const row = await db.notice.create({ data: { title: title.slice(0, 200), body: body.slice(0, 10_000), pinned: on(f, "pinned") } });
    await audit(`staff:${st.id}`, "notice.create", `notice:${row.id}`, { title });
    return "공지를 올렸어요.";
  });
}

export async function noticeToggleAction(f: FormData) {
  await act("/admin/notices", "content_pages", async (st) => {
    const row = await db.notice.findUniqueOrThrow({ where: { id: s(f, "id") } });
    const field = s(f, "field") === "pinned" ? "pinned" : "published";
    await db.notice.update({ where: { id: row.id }, data: { [field]: !row[field] } });
    await audit(`staff:${st.id}`, `notice.${field}.${row[field] ? "off" : "on"}`, `notice:${row.id}`);
    if (field === "pinned") return row.pinned ? "고정을 풀었어요." : "맨 위에 고정했어요.";
    return row.published ? "공지를 내렸어요." : "공지를 다시 올렸어요.";
  });
}

export async function faqCreateAction(f: FormData) {
  await act("/admin/faqs", "content_pages", async (st) => {
    const question = s(f, "question");
    const answer = s(f, "answer");
    if (!question || !answer) throw new HttpError(400, "EMPTY", "질문과 답을 적어 주세요.");
    const row = await db.faq.create({ data: { category: s(f, "category") || "etc", question: question.slice(0, 300), answer: answer.slice(0, 5000), sort: n(f, "sort") ?? 0 } });
    await audit(`staff:${st.id}`, "faq.create", `faq:${row.id}`, { question });
    return "FAQ를 올렸어요.";
  });
}

export async function faqToggleAction(f: FormData) {
  await act("/admin/faqs", "content_pages", async (st) => {
    const row = await db.faq.findUniqueOrThrow({ where: { id: s(f, "id") } });
    await db.faq.update({ where: { id: row.id }, data: { published: !row.published } });
    await audit(`staff:${st.id}`, row.published ? "faq.unpublish" : "faq.publish", `faq:${row.id}`);
    return row.published ? "FAQ를 내렸어요." : "FAQ를 다시 올렸어요.";
  });
}

// ── 직원·API 키 (관리자만) ──
export async function staffCreateAction(f: FormData) {
  await act("/admin/staff", "staff", async (st) => {
    const email = s(f, "email").toLowerCase();
    const password = String(f.get("password") ?? "");
    const role = s(f, "role");
    if (!isStaffRole(role)) throw new HttpError(400, "BAD_ROLE", "역할을 골라 주세요.");
    if (!/^[^@\s]+@[^@\s]+$/.test(email) || email.length > 254) throw new HttpError(400, "BAD_EMAIL", "이메일을 확인해 주세요.");
    if (password.length < 10 || password.length > 100) throw new HttpError(400, "BAD_PASSWORD", "비밀번호는 10자 이상으로 정해 주세요.");
    if (await db.staff.findUnique({ where: { email } })) throw new HttpError(409, "EXISTS", "이미 있는 직원 이메일이에요.");
    const row = await db.staff.create({ data: { email, name: s(f, "name").slice(0, 30) || email, role, password_hash: await hashPassword(password) } });
    await audit(`staff:${st.id}`, "staff.create", `staff:${row.id}`, { email, role });
    return "직원을 추가했어요.";
  });
}

export async function staffToggleAction(f: FormData) {
  await act("/admin/staff", "staff", async (st) => {
    const id = s(f, "id");
    if (id === st.id) throw new HttpError(400, "SELF", "내 계정은 끌 수 없어요.");
    const row = await db.staff.findUniqueOrThrow({ where: { id } });
    await db.$transaction(async (tx) => {
      await tx.staff.update({ where: { id }, data: { active: !row.active } });
      if (row.active) await tx.staffSession.deleteMany({ where: { staff_id: id } });
      await audit(`staff:${st.id}`, row.active ? "staff.disable" : "staff.enable", `staff:${id}`, undefined, tx);
    });
    return row.active ? "직원 계정을 끄고 로그인을 끊었어요." : "직원 계정을 켰어요.";
  });
}

export async function staffRoleAction(f: FormData) {
  await act("/admin/staff", "staff", async (st) => {
    const id = s(f, "id");
    const role = s(f, "role");
    if (!isStaffRole(role)) throw new HttpError(400, "BAD_ROLE", "역할을 골라 주세요.");
    if (id === st.id) throw new HttpError(400, "SELF", "내 역할은 바꿀 수 없어요.");
    const row = await db.staff.update({ where: { id }, data: { role } });
    await audit(`staff:${st.id}`, "staff.role", `staff:${id}`, { role });
    return `${row.name} 님 역할을 바꿨어요.`;
  });
}

export async function apiKeyIssueAction(f: FormData) {
  await act("/admin/api-keys", "api_keys", async (st) => {
    const scopes = f.getAll("scopes").map(String).filter((x): x is Scope => (SCOPES as string[]).includes(x));
    const name = s(f, "name");
    if (!name) throw new HttpError(400, "EMPTY", "키 이름을 적어 주세요.");
    const k = await issueApiKey(name, scopes, st.id);
    // 원문은 한 번만 보여 준다: 1분짜리 쿠키로 다음 화면에 넘긴다(주소창·로그에 남지 않게)
    (await cookies()).set(NEW_KEY_COOKIE, k.key, { httpOnly: true, sameSite: "strict", path: "/admin/api-keys", maxAge: 60 });
    await audit(`staff:${st.id}`, "apikey.issue", `apikey:${k.id}`, { name, scopes });
    return "키를 만들었어요. 원문은 지금 한 번만 보여 드려요.";
  });
}

export async function apiKeyRevokeAction(f: FormData) {
  await act("/admin/api-keys", "api_keys", async (st) => {
    await revokeApiKey(s(f, "id"));
    await audit(`staff:${st.id}`, "apikey.revoke", `apikey:${s(f, "id")}`);
    return "키를 폐기했어요. 이 키로 오는 요청은 이제 401이에요.";
  });
}
