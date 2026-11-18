import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CourseThumb } from "@/components/CourseThumb";
import { LogoutButton } from "@/components/AuthForms";
import { ENROLLMENT_SOURCE_LABEL, ORDER_STATUS_LABEL, won } from "@/lib/format";
import { kstDate } from "@/rules/time";
import { currentUser } from "@/server/auth/current";
import { db } from "@/server/db";
import { listOrdersForUser } from "@/server/orders";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "마이페이지" };

/** 마이페이지: 내 강의실(수강 중인 강의)과 최근 주문. 진도·이어보기는 플레이어 작업(Task 12)이 더한다. */
export default async function MyPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/my");
  const now = new Date();
  const [enrollments, orders] = await Promise.all([
    db.enrollment.findMany({
      where: { user_id: user.id, status: "active", OR: [{ expires_at: null }, { expires_at: { gt: now } }] },
      include: { course: { include: { category: true, instructor: true } } },
      orderBy: { updated_at: "desc" },
    }),
    listOrdersForUser(user.id, 5),
  ]);
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{user.name}님의 마이페이지</h1>
          <p className="mt-1 text-sm text-slate-500">{user.email}</p>
        </div>
        <LogoutButton />
      </div>

      <section className="mt-8" aria-labelledby="classroom">
        <h2 id="classroom" className="text-xl font-bold">내 강의실</h2>
        {enrollments.length === 0 ? (
          <div className="mt-3 rounded-2xl bg-white p-8 text-center text-sm text-slate-600 ring-1 ring-slate-200">
            아직 수강 중인 강의가 없어요. <Link href="/courses" className="font-semibold text-brand-600 underline">강의 둘러보기</Link>
          </div>
        ) : (
          <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {enrollments.map((e) => (
              <li key={e.id} data-testid="classroom-course" className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
                <Link href={`/courses/${e.course.code}`} className="block">
                  <CourseThumb code={e.course.code} category={e.course.category.code} title={e.course.title} className="aspect-video w-full" />
                  <div className="p-4">
                    <p className="text-xs font-semibold text-brand-600">{e.course.instructor.display_name}</p>
                    <p className="mt-0.5 line-clamp-2 font-semibold">{e.course.title}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      {ENROLLMENT_SOURCE_LABEL[e.source] ?? e.source} · {e.expires_at ? `${kstDate(e.expires_at)}까지` : e.source === "subscription" ? "구독 중" : "평생 수강"}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10" aria-labelledby="recent-orders">
        <div className="flex items-center justify-between">
          <h2 id="recent-orders" className="text-xl font-bold">최근 주문</h2>
          <Link href="/my/orders" className="text-sm font-semibold text-brand-600 hover:underline">주문·환불 전체</Link>
        </div>
        <ul className="mt-3 divide-y divide-slate-100 rounded-2xl bg-white ring-1 ring-slate-200">
          {orders.length === 0 && <li className="p-5 text-sm text-slate-500">주문한 적이 없어요.</li>}
          {orders.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
              <Link href={`/my/orders/${o.code}`} className="font-mono font-semibold hover:text-brand-700">{o.code}</Link>
              <span className="min-w-0 flex-1 truncate text-slate-600">{o.items[0]?.course?.title ?? o.items[0]?.bundle?.title}{o.items.length > 1 ? ` 외 ${o.items.length - 1}건` : ""}</span>
              <span className="price">{won(o.payable)}</span>
              <span className="badge">{ORDER_STATUS_LABEL[o.status] ?? o.status}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
