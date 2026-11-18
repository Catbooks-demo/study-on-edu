import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CourseThumb } from "@/components/CourseThumb";
import { LogoutButton } from "@/components/AuthForms";
import { ORDER_STATUS_LABEL, won } from "@/lib/format";
import { currentUser } from "@/server/auth/current";
import { myClassroom } from "@/server/classroom";
import { listOrdersForUser } from "@/server/orders";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "마이페이지" };

const MENU = [
  ["/my/classroom", "내 강의실"],
  ["/my/orders", "주문·환불"],
  ["/my/notes", "노트"],
  ["/my/questions", "내 질문"],
  ["/my/inquiries", "1:1 문의"],
  ["/my/devices", "기기 관리"],
  ["/my/profile", "회원 정보"],
] as const;

/** 마이페이지: 이어서 볼 강의(진도·이어보기), 최근 주문, 메뉴. */
export default async function MyPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/my");
  const [room, orders] = await Promise.all([myClassroom(user.id), listOrdersForUser(user.id, 5)]);
  const cards = [...room.active, ...room.completed];
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{user.name}님의 마이페이지</h1>
          <p className="mt-1 text-sm text-slate-500">{user.email}</p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/my/subscription" className="text-sm font-semibold text-brand-600 hover:underline">구독 관리</Link>
          <LogoutButton />
        </div>
      </div>
      <nav aria-label="마이페이지 메뉴" className="mt-6 flex flex-wrap gap-2 text-sm">
        {MENU.map(([href, label]) => (
          <Link key={href} href={href} className="rounded-full bg-white px-3 py-1.5 font-semibold text-slate-700 ring-1 ring-slate-200 hover:text-brand-700">{label}</Link>
        ))}
      </nav>

      <section className="mt-8" aria-labelledby="classroom">
        <div className="flex items-center justify-between">
          <h2 id="classroom" className="text-xl font-bold">내 강의실</h2>
          <Link href="/my/classroom" className="text-sm font-semibold text-brand-600 hover:underline">전체 보기</Link>
        </div>
        {cards.length === 0 ? (
          <div className="mt-3 rounded-2xl bg-white p-8 text-center text-sm text-slate-600 ring-1 ring-slate-200">
            아직 수강 중인 강의가 없어요. <Link href="/courses" className="font-semibold text-brand-600 underline">강의 둘러보기</Link>
          </div>
        ) : (
          <ul className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((c) => {
              const target = c.resume?.lecture_id ?? c.first_lecture_id;
              return (
                <li key={c.course_code} data-testid="classroom-course" className="overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200">
                  <Link href={target ? `/learn/${c.course_code}/${target}` : `/courses/${c.course_code}`} className="block">
                    <CourseThumb code={c.course_code} category={c.category} title={c.title} className="aspect-video w-full" />
                    <div className="p-4">
                      <p className="line-clamp-2 font-semibold">{c.title}</p>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full bg-brand-500" style={{ width: `${Math.floor(c.progress_ratio * 100)}%` }} />
                      </div>
                      <p className="mt-1.5 text-xs text-slate-500">진도율 {Math.floor(c.progress_ratio * 100)}% · {c.resume ? "이어보기" : "학습 시작"}</p>
                    </div>
                  </Link>
                </li>
              );
            })}
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
