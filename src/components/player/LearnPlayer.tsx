"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { type LectureScriptLike, clipFromScript } from "@/lib/fakevideo/clips";
import { FakeVideo } from "./FakeVideo";
import { NotesPanel } from "./NotesPanel";
import { QuestionsPanel } from "./QuestionsPanel";
import { PlayerControls } from "./PlayerControls";
import { ResourceButton } from "./ResourceButton";
import { usePlayback } from "./usePlayback";

const pctText = (r: number) => `${(Math.floor(r * 1000) / 10).toFixed(r > 0 && r < 0.1 ? 1 : 0)}%`;

/** 플레이어 본체: 가짜 영상 + 조작 + 진도 + 노트·질문 탭. */
export function LearnPlayer(props: {
  lecture: { id: string; title: string; duration_sec: number; has_resource: boolean; script: unknown };
  course: { id: string; code: string; title: string; category: string };
  enrolled: boolean;
  resumeSec: number;
  downloaded: boolean;
  initial: { watched_sec: number; done: boolean; course_progress: number };
}) {
  const { lecture, course, enrolled } = props;
  const script = lecture.script as LectureScriptLike | null;
  const clip = useMemo(
    () =>
      clipFromScript({
        code: course.code,
        category: course.category,
        courseTitle: course.title,
        lectureTitle: lecture.title,
        lectureId: lecture.id,
        duration_sec: lecture.duration_sec,
        script: script && Array.isArray(script.slides) ? script : null,
      }),
    [course.code, course.category, course.title, lecture.title, lecture.id, lecture.duration_sec, script],
  );
  const p = usePlayback({ lectureId: lecture.id, duration: lecture.duration_sec, resumeSec: props.resumeSec, enrolled, initial: props.initial });
  const [tab, setTab] = useState<"notes" | "questions">("notes");
  const lectureRatio = Math.min(1, p.progress.watched_sec / Math.max(1, lecture.duration_sec));

  return (
    <div>
      <div className="overflow-hidden rounded-2xl border-4 border-ink">
        <FakeVideo clip={clip} time={p.position} label={`${lecture.title} 강의 영상 (시연용 가짜 영상)`} />
        <PlayerControls
          position={p.position}
          duration={lecture.duration_sec}
          playing={p.playing}
          busy={p.starting}
          rate={p.rate}
          onPlay={() => void p.play()}
          onPause={p.pause}
          onSeek={p.seek}
          onRate={p.setRate}
        />
      </div>

      {p.notice && (
        <div role="alert" className={`mt-3 rounded-xl px-4 py-3 text-sm ${p.notice.kind === "elsewhere" ? "bg-lemon-300/40 text-ink" : "bg-red-50 text-red-700"}`}>
          <p>{p.notice.message}</p>
          {p.notice.kind === "elsewhere" && <p className="mt-1 text-xs text-slate-600">여기서 이어 보려면 재생을 다시 눌러 주세요. 동시에 재생할 수 있는 기기는 1대예요.</p>}
          {p.notice.kind === "device_limit" && (
            <Link href="/my/devices" className="mt-1 inline-block font-semibold text-brand-700 underline">기기 관리로 가기</Link>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
        {enrolled ? (
          <>
            <p className="text-sm">
              이 강 진도{" "}
              <strong data-testid="lecture-progress" className="tabular-nums">{pctText(lectureRatio)}</strong>
              <span data-testid="lecture-watched" data-sec={p.progress.watched_sec} className="sr-only">본 시간 {p.progress.watched_sec}초</span>
              {p.progress.done && <span className="badge ml-2 bg-brand-50 text-brand-700 ring-brand-200">완료</span>}
            </p>
            <p className="text-sm">
              강의 진도율 <strong data-testid="course-progress" className="tabular-nums">{pctText(p.progress.course_progress)}</strong>
            </p>
            {lecture.has_resource && <div className="ml-auto"><ResourceButton lectureId={lecture.id} downloaded={props.downloaded} /></div>}
          </>
        ) : (
          <p className="text-sm text-slate-600">
            맛보기 강이에요. 진도는 저장되지 않아요.{" "}
            <Link href={`/courses/${course.code}`} className="font-semibold text-brand-700 underline">수강 신청하러 가기</Link>
          </p>
        )}
      </div>

      {enrolled && (
        <div className="mt-4 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <div role="tablist" aria-label="학습 도구" className="flex gap-4 border-b border-slate-200 text-sm font-semibold">
            {(["notes", "questions"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={`-mb-px border-b-2 px-1 pb-2 ${tab === t ? "border-brand-500 text-brand-700" : "border-transparent text-slate-500"}`}
              >
                {t === "notes" ? "노트" : "질문"}
              </button>
            ))}
          </div>
          <div className="pt-4" role="tabpanel">
            {tab === "notes" ? (
              <NotesPanel lectureId={lecture.id} courseId={course.id} position={p.position} onSeek={p.seek} />
            ) : (
              <QuestionsPanel lectureId={lecture.id} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
