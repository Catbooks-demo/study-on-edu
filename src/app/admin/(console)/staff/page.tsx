import { staffCreateAction, staffRoleAction, staffToggleAction } from "@/app/admin/actions";
import { ActionButton, Card, Flash, PageTitle, Pill, Table, Td } from "@/components/admin/ui";
import { dateTimeKo } from "@/lib/format";
import { db } from "@/server/db";
import { STAFF_ROLES } from "@/server/roles";
import { type SP, guard } from "../guard";

export const metadata = { title: "직원" };

const ROLE_KO: Record<string, string> = { admin: "관리자", cs: "고객 지원", content: "콘텐츠" };
const ROLE_HELP: Record<string, string> = {
  admin: "모든 화면, 정산 확정·운영·직원·API 키",
  cs: "주문·환불·구독·수강생·문의·질문·후기·보낸 편지함",
  content: "강의 심사·강의·패키지·플랜·쿠폰·라이브·공지·FAQ·강사 보기",
};

export default async function StaffPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const me = await guard("staff");
  const rows = await db.staff.findMany({ include: { _count: { select: { sessions: true } } }, orderBy: { created_at: "asc" } });
  return (
    <>
      <PageTitle title="직원" sub="관리자만 볼 수 있어요. 계정을 끄면 바로 로그인이 끊겨요." />
      <Flash sp={sp} />
      <Table head={["이름", "이메일", "역할", "상태", "로그인 세션", "추가", ""]}>
        {rows.map((s) => (
          <tr key={s.id}>
            <Td>{s.name}{s.id === me.id && <span className="ml-1 text-xs text-slate-400">(나)</span>}</Td>
            <Td className="text-slate-600">{s.email}</Td>
            <Td>
              {s.id === me.id ? ROLE_KO[s.role] : (
                <form action={staffRoleAction} className="flex gap-1">
                  <input type="hidden" name="id" value={s.id} />
                  <select name="role" defaultValue={s.role} aria-label={`${s.name} 역할`} className="field w-28 py-1.5">{STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_KO[r]}</option>)}</select>
                  <button className="btn-line px-2 py-1.5">바꾸기</button>
                </form>
              )}
            </Td>
            <Td>{s.active ? <Pill tone="green">사용 중</Pill> : <Pill tone="gray">꺼짐</Pill>}</Td>
            <Td className="tabular-nums">{s._count.sessions}</Td>
            <Td className="text-slate-500">{dateTimeKo(s.created_at.toISOString())}</Td>
            <Td>{s.id !== me.id && <ActionButton action={staffToggleAction} fields={{ id: s.id }} label={s.active ? "끄기" : "켜기"} tone={s.active ? "danger" : "line"} confirm={s.active ? `${s.name} 님 계정을 끌까요?` : undefined} />}</Td>
          </tr>
        ))}
      </Table>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card title="직원 추가">
          <form action={staffCreateAction} className="grid gap-3 text-sm sm:grid-cols-2">
            <div><label htmlFor="name" className="label">이름</label><input id="name" name="name" required maxLength={30} className="field" /></div>
            <div><label htmlFor="email" className="label">이메일</label><input id="email" name="email" type="email" required className="field" /></div>
            <div><label htmlFor="password" className="label">처음 비밀번호 (10자 이상)</label><input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" className="field" /></div>
            <div>
              <label htmlFor="role" className="label">역할</label>
              <select id="role" name="role" defaultValue="cs" className="field">{STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_KO[r]}</option>)}</select>
            </div>
            <button className="btn-primary sm:col-span-2">추가</button>
          </form>
        </Card>
        <Card title="역할별 권한">
          <ul className="space-y-2 text-sm">
            {STAFF_ROLES.map((r) => <li key={r}><b>{ROLE_KO[r]}</b> <span className="text-slate-600">— {ROLE_HELP[r]}</span></li>)}
          </ul>
        </Card>
      </div>
    </>
  );
}
