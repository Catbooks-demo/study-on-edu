import { couponCreateAction, couponToggleAction } from "@/app/admin/actions";
import { ActionButton, Card, Flash, PageTitle, Pill, Table, Td } from "@/components/admin/ui";
import { dateShort, dateTimeKo, won } from "@/lib/format";
import { addDays, kstDate } from "@/rules/time";
import { db } from "@/server/db";
import { type SP, guard } from "../guard";

export const metadata = { title: "쿠폰" };

const SOURCE_KO: Record<string, string> = { site: "사이트", admin: "직원", api: "외부 API" };
const TARGET_KO: Record<string, string> = { all: "전체", category: "분야", course: "강의", instructor: "강사" };

export default async function Coupons({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await guard("catalog");
  const now = new Date();
  const today = kstDate(now);
  const [rows, grants] = await Promise.all([
    db.coupon.findMany({
      include: { instructor: { select: { display_name: true } }, _count: { select: { holders: true } } },
      orderBy: { created_at: "desc" },
    }),
    db.userCoupon.findMany({
      include: { user: { select: { email: true } }, coupon: { select: { code: true } } },
      orderBy: { issued_at: "desc" },
      take: 30,
    }),
  ]);
  return (
    <>
      <PageTitle
        title="쿠폰"
        sub="쿠폰은 단건·패키지 주문에만 쓰여요. 강사 추천 코드(REF-)는 그 강사 본인 강의 판매에 90% 정산이 적용돼요. '받은 회원만' 쿠폰은 쿠폰함에 받은 회원만 쓸 수 있어요."
      />
      <Flash sp={sp} />
      <Table head={["코드", "이름", "할인", "대상", "기간", "발급", "사용", "조건", "상태", ""]} empty={rows.length === 0}>
        {rows.map((c) => {
          const live = c.active && c.starts_at <= now && now <= c.ends_at;
          return (
            <tr key={c.id}>
              <Td className="font-mono text-xs">{c.code}{c.referral && <Pill tone="brand">추천</Pill>}{c.private && <Pill tone="brand">받은 회원만</Pill>}</Td>
              <Td className="max-w-48 truncate">{c.name}{c.instructor ? ` · ${c.instructor.display_name}` : ""}</Td>
              <Td className="tabular-nums">{c.kind === "percent" ? `${c.value}%${c.max_discount ? ` (최대 ${won(c.max_discount)})` : ""}` : won(c.value)}</Td>
              <Td>{TARGET_KO[c.target] ?? c.target}{c.target_ref ? ` · ${c.target_ref}` : ""}</Td>
              <Td className="text-slate-600">{dateShort(kstDate(c.starts_at))} ~ {dateShort(kstDate(c.ends_at))}</Td>
              <Td className="tabular-nums">{c._count.holders}</Td>
              <Td className="tabular-nums">{c.used_count}{c.total_limit ? `/${c.total_limit}` : ""}</Td>
              <Td className="text-xs text-slate-500">{[c.per_user_once && "1인 1회", c.min_amount && `${won(c.min_amount)} 이상`].filter(Boolean).join(" · ") || "-"}</Td>
              <Td>{live ? <Pill tone="green">쓸 수 있음</Pill> : <Pill tone="gray">{c.active ? "기간 밖" : "꺼짐"}</Pill>}</Td>
              <Td><ActionButton action={couponToggleAction} fields={{ id: c.id }} label={c.active ? "끄기" : "켜기"} /></Td>
            </tr>
          );
        })}
      </Table>
      <Card title="새 쿠폰" className="mt-6">
        <form action={couponCreateAction} className="grid gap-3 text-sm sm:grid-cols-4">
          <div><label htmlFor="code" className="label">코드</label><input id="code" name="code" required placeholder="WINTER20" className="field uppercase" /></div>
          <div className="sm:col-span-2"><label htmlFor="name" className="label">이름</label><input id="name" name="name" placeholder="겨울 맞이 20% 할인" className="field" /></div>
          <div>
            <label htmlFor="kind" className="label">종류</label>
            <select id="kind" name="kind" className="field"><option value="percent">정률 (%)</option><option value="fixed">정액 (원)</option></select>
          </div>
          <div><label htmlFor="value" className="label">할인 값</label><input id="value" name="value" inputMode="numeric" required className="field" /></div>
          <div><label htmlFor="max_discount" className="label">최대 할인 (원)</label><input id="max_discount" name="max_discount" inputMode="numeric" className="field" /></div>
          <div><label htmlFor="min_amount" className="label">최소 주문 (원)</label><input id="min_amount" name="min_amount" inputMode="numeric" className="field" /></div>
          <div><label htmlFor="total_limit" className="label">전체 수량</label><input id="total_limit" name="total_limit" inputMode="numeric" className="field" /></div>
          <div>
            <label htmlFor="target" className="label">대상</label>
            <select id="target" name="target" className="field"><option value="all">전체</option><option value="category">분야</option><option value="course">강의</option><option value="instructor">강사</option></select>
          </div>
          <div><label htmlFor="target_ref" className="label">대상 값</label><input id="target_ref" name="target_ref" placeholder="DEV · SO-DEV-0001 · slug" className="field" /></div>
          <div><label htmlFor="starts_on" className="label">시작일</label><input id="starts_on" name="starts_on" type="date" defaultValue={today} required className="field" /></div>
          <div><label htmlFor="ends_on" className="label">마감일</label><input id="ends_on" name="ends_on" type="date" defaultValue={addDays(today, 30)} required className="field" /></div>
          <label className="flex items-center gap-2"><input type="checkbox" name="per_user_once" /> 1인 1회</label>
          <label className="flex items-center gap-2 sm:col-span-2"><input type="checkbox" name="private" /> 받은 회원만 (쿠폰함, 1인 1회)</label>
          <button className="btn-primary">만들기</button>
        </form>
      </Card>
      <Card title="최근 쿠폰함 발급" className="mt-6">
        <Table head={["발급 때", "회원", "쿠폰", "보낸 곳"]} empty={grants.length === 0}>
          {grants.map((g) => (
            <tr key={g.id}>
              <Td className="text-slate-500">{dateTimeKo(g.issued_at.toISOString())}</Td>
              <Td>{g.user.email}</Td>
              <Td className="font-mono text-xs">{g.coupon.code}</Td>
              <Td>{SOURCE_KO[g.source] ?? g.source}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
