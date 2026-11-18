import { liveCancelAction, liveReplayAction } from "@/app/admin/actions";
import { DemoBadge } from "@/components/DemoBadge";
import { Card, Flash, PageTitle, Pill, Table, Td, toneOf } from "@/components/admin/ui";
import { dateTimeKo } from "@/lib/format";
import { db } from "@/server/db";
import { liveViewers } from "@/server/live";
import { type SP, guard } from "../guard";

export const metadata = { title: "라이브" };

const LIVE_KO: Record<string, string> = { scheduled: "예정", live: "방송 중", ended: "끝남", cancelled: "취소" };

export default async function Live({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await guard("live");
  const now = new Date();
  const rows = await db.liveSession.findMany({
    include: {
      instructor: { select: { display_name: true } },
      course: { select: { code: true, title: true, sections: { orderBy: { sort: "asc" }, select: { id: true, title: true } } } },
      replay_lecture: { select: { title: true } },
      _count: { select: { seats: true, chats: true } },
    },
    orderBy: { starts_at: "desc" },
    take: 60,
  });
  return (
    <>
      <PageTitle title="라이브" sub="방송 상태는 시작·끝 시각에 맞춰 작업이 바꿔요. 끝난 강의 라이브는 다시보기 강으로 붙일 수 있어요." />
      <Flash sp={sp} />
      <Table head={["시작", "제목", "강사", "강의", "예약", "지금 시청", "상태", "할 일"]} empty={rows.length === 0}>
        {rows.map((l) => (
          <tr key={l.id} className="align-top">
            <Td>{dateTimeKo(l.starts_at.toISOString())}<div className="text-xs text-slate-400">~ {dateTimeKo(l.ends_at.toISOString())}</div></Td>
            <Td className="max-w-64 whitespace-normal">{l.title}</Td>
            <Td>{l.instructor.display_name} <DemoBadge /></Td>
            <Td className="max-w-48 truncate text-slate-600">{l.course ? l.course.title : "단독 라이브"}</Td>
            <Td className="tabular-nums">{l._count.seats}/{l.capacity}</Td>
            <Td className="tabular-nums">{l.status === "live" ? `${liveViewers(l.id, now)}명` : "-"}</Td>
            <Td><Pill tone={toneOf(l.status)}>{LIVE_KO[l.status] ?? l.status}</Pill></Td>
            <Td className="whitespace-normal">
              {l.status === "scheduled" && (
                <form action={liveCancelAction} className="flex gap-1">
                  <input type="hidden" name="id" value={l.id} />
                  <input name="reason" required placeholder="취소 사유" aria-label="취소 사유" className="field w-36 py-1.5" />
                  <button className="btn border border-rose-300 bg-white px-3 py-1.5 text-rose-700">취소</button>
                </form>
              )}
              {l.status === "ended" && l.course && !l.replay_lecture && (
                <form action={liveReplayAction} className="flex gap-1">
                  <input type="hidden" name="id" value={l.id} />
                  <select name="section_id" aria-label="붙일 섹션" className="field w-40 py-1.5">
                    {l.course.sections.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
                  </select>
                  <button className="btn-line px-3 py-1.5">다시보기 붙이기</button>
                </form>
              )}
              {l.replay_lecture && <span className="text-xs text-slate-500">다시보기: {l.replay_lecture.title}</span>}
            </Td>
          </tr>
        ))}
      </Table>
      <Card className="mt-4"><p className="text-sm text-slate-500">라이브 입장 대기열 설정은 운영 메뉴에서 해요.</p></Card>
    </>
  );
}
