import type {
  Bundle,
  Category,
  Coupon,
  Course,
  Enrollment,
  Incident,
  Inquiry,
  Instructor,
  Order,
  OrderItem,
  Payment,
  Plan,
  Refund,
  Subscription,
  User,
} from "@prisma/client";

/**
 * v1 응답 모양 (copy and adapt from nubi-tour/src/server/v1/serialize.ts).
 * read 범위는 이름·전화·이메일을 가리고 read_pii는 원문. 비밀번호 해시·세션·기기 키·결제 키·카드(끝 4자리 말고)는 어느 범위에도 넣지 않는다.
 */
export function maskKo(name: string): string {
  if (name.length <= 1) return "*";
  if (name.length === 2) return `${name[0]}*`;
  return `${name[0]}${"*".repeat(name.length - 2)}${name.at(-1)}`;
}
export function maskPhone(p: string): string {
  const d = p.replace(/[^0-9]/g, "");
  return d.length >= 10 ? `${d.slice(0, 3)}-****-${d.slice(-4)}` : "***";
}
export function maskEmail(e: string): string {
  const [u, dom] = e.split("@");
  return dom ? `${u[0] ?? ""}***@${dom}` : "***";
}

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

export function memberV1(u: Pick<User, "id" | "name" | "email" | "phone">, pii: boolean) {
  return pii
    ? { id: u.id, name: u.name, email: u.email, phone: u.phone }
    : { id: u.id, name: maskKo(u.name), email: maskEmail(u.email), phone: maskPhone(u.phone) };
}

export function courseV1(c: Course & { category: Category; instructor: Instructor }) {
  return {
    id: c.id,
    code: c.code,
    title: c.title,
    category: c.category.code,
    instructor_slug: c.instructor.slug,
    level: c.level,
    price: c.price,
    sale_price: c.sale_price,
    sale_ends_at: iso(c.sale_ends_at),
    access_days: c.access_days,
    status: c.status,
    in_subscription: c.in_subscription,
    rating_avg: c.rating_avg,
    rating_count: c.rating_count,
    published_at: iso(c.published_at),
    created_at: iso(c.created_at),
    updated_at: iso(c.updated_at),
  };
}

export function instructorV1(i: Instructor) {
  return { id: i.id, slug: i.slug, display_name: i.display_name, status: i.status, created_at: iso(i.created_at), updated_at: iso(i.updated_at) };
}

type ItemRow = OrderItem & { course: Course | null; bundle: Bundle | null };
export function orderV1(o: Order & { user: User; items: ItemRow[]; coupon: Coupon | null }, pii: boolean) {
  return {
    id: o.id,
    code: o.code,
    status: o.status,
    member: memberV1(o.user, pii),
    list_total: o.list_total,
    discount_total: o.discount_total,
    coupon_code: o.coupon?.code ?? null,
    coupon_discount: o.coupon_discount,
    payable: o.payable,
    refunded_amount: o.refunded_amount,
    paid_at: iso(o.paid_at),
    expires_at: iso(o.expires_at),
    items: o.items.map((i) => ({
      id: i.id,
      kind: i.kind,
      course_code: i.course?.code ?? null,
      bundle_code: i.bundle?.code ?? null,
      list_price: i.list_price,
      unit_price: i.unit_price,
      coupon_share: i.coupon_share,
      paid_amount: i.paid_amount,
      refunded_amount: i.refunded_amount,
      status: i.status,
    })),
    created_at: iso(o.created_at),
    updated_at: iso(o.updated_at),
  };
}

export function paymentV1(p: Payment & { order: Order | null }) {
  return {
    id: p.id,
    order_code: p.order?.code ?? null,
    invoice_id: p.invoice_id,
    kind: p.kind,
    method: p.method,
    amount: p.amount,
    status: p.status,
    refund_of: p.refund_of_id,
    refund_id: p.refund_id,
    failure_reason: p.failure_reason,
    approved_at: iso(p.approved_at),
    created_at: iso(p.created_at),
    updated_at: iso(p.updated_at),
  };
}

export function refundV1(r: Refund & { order_item: (OrderItem & { order: Order }) | null }) {
  return {
    id: r.id,
    member_id: r.user_id,
    order_code: r.order_item?.order.code ?? null,
    order_item_id: r.order_item_id,
    invoice_id: r.invoice_id,
    reason: r.reason,
    calc_amount: r.calc_amount,
    amount: r.amount,
    adjust_reason: r.adjust_reason,
    status: r.status,
    approved_at: iso(r.approved_at),
    done_at: iso(r.done_at),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

export function subscriptionV1(s: Subscription & { user: User; plan: Plan }, pii: boolean) {
  return {
    id: s.id,
    member: memberV1(s.user, pii),
    plan_code: s.plan.code,
    status: s.status,
    current_period_start: iso(s.current_period_start),
    current_period_end: iso(s.current_period_end),
    cancel_at_period_end: s.cancel_at_period_end,
    failure_count: s.failure_count,
    next_retry_at: iso(s.next_retry_at),
    paused_until: iso(s.paused_until),
    card_last4: s.card_last4,
    cancelled_at: iso(s.cancelled_at),
    created_at: iso(s.created_at),
    updated_at: iso(s.updated_at),
  };
}

export function enrollmentV1(e: Enrollment & { course: Course }) {
  return {
    id: e.id,
    member_id: e.user_id,
    course_code: e.course.code,
    source: e.source,
    status: e.status,
    starts_at: iso(e.starts_at),
    expires_at: iso(e.expires_at),
    created_at: iso(e.created_at),
    updated_at: iso(e.updated_at),
  };
}

export function inquiryV1(q: Inquiry & { user: User }, pii: boolean) {
  return {
    id: q.id,
    member: memberV1(q.user, pii),
    category: q.category,
    title: q.title,
    body: q.body,
    status: q.status,
    answer: q.answer,
    answered_at: iso(q.answered_at),
    created_at: iso(q.created_at),
    updated_at: iso(q.updated_at),
  };
}

export function incidentV1(i: Incident) {
  return {
    id: i.id,
    title: i.title,
    body: i.body,
    components: i.components,
    severity: i.severity,
    status: i.status,
    started_at: iso(i.started_at),
    resolved_at: iso(i.resolved_at),
    created_at: iso(i.created_at),
    updated_at: iso(i.updated_at),
  };
}
