import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { courseCodes, lectureScript } from "../prisma/seed-lib";
import { COURSES } from "../prisma/seed-data/courses";
import { LecturePlayer } from "@/components/LecturePlayer";
import { EXAMS, ddayLabel, examStatus } from "@/lib/exams";
import { clipForCourse, clipFromLecture, heroClip } from "@/lib/fakevideo/clips";
import { type Op, clipDuration, composeFrame, partial, posterTime, scribble } from "@/lib/fakevideo/frame";

const texts = (ops: Op[]) => ops.filter((o): o is Extract<Op, { op: "text" }> => o.op === "text").map((o) => o.text);

describe("가짜 영상 렌더러", () => {
  it("hero clip loops in 8..15 seconds", () => {
    const d = clipDuration(heroClip());
    expect(d).toBeGreaterThanOrEqual(8);
    expect(d).toBeLessThanOrEqual(15);
  });

  it("every course and preview clip is 8..15 seconds", () => {
    const codes = courseCodes();
    COURSES.forEach((c, i) => {
      const d = clipDuration(clipForCourse({ code: codes[i], category: c.cat, title: c.title }));
      expect(d, codes[i]).toBeGreaterThanOrEqual(8);
      expect(d, codes[i]).toBeLessThanOrEqual(15);
      const script = lectureScript(`${codes[i]}:1`, "첫 강", "섹션", 600);
      const p = clipDuration(clipFromLecture({ code: codes[i], category: c.cat, courseTitle: c.title, lectureTitle: "첫 강", script }));
      expect(p, codes[i]).toBeGreaterThanOrEqual(8);
      expect(p, codes[i]).toBeLessThanOrEqual(15);
    });
  });

  it("same clip and time → same frame, and it loops", () => {
    const clip = heroClip();
    expect(composeFrame(clip, 5.2)).toEqual(composeFrame(heroClip(), 5.2));
    expect(composeFrame(clip, 5.2 + clipDuration(clip))).toEqual(composeFrame(clip, 5.2));
  });

  it("shows slides, then code being typed, then a chart", () => {
    const clip = heroClip();
    const [slide, code] = clip.scenes;
    expect(texts(composeFrame(clip, 3))).toContain("반복문 for와 while");
    const early = texts(composeFrame(clip, slide.dur + 0.8)).join("");
    const late = texts(composeFrame(clip, slide.dur + code.dur - 0.1)).join("");
    expect(late.length).toBeGreaterThan(early.length);
    expect(late).toContain("total");
    expect(texts(composeFrame(clip, slide.dur + code.dur + 3.5))).toContain("요일별 공부 시간 (분)");
  });

  it("handwritten marks draw progressively", () => {
    const pts = scribble({ kind: "circle", cx: 100, cy: 100, rx: 40, ry: 20, at: 0 }, "s");
    expect(partial(pts, 0)).toHaveLength(0);
    expect(partial(pts, 0.5).length).toBeLessThan(pts.length);
    expect(partial(pts, 1)).toEqual(pts);
    expect(scribble({ kind: "circle", cx: 100, cy: 100, rx: 40, ry: 20, at: 0 }, "s")).toEqual(pts);
  });

  it("reduced-motion poster renders on the server (no canvas)", () => {
    const clip = heroClip();
    const html = renderToStaticMarkup(createElement(LecturePlayer, { clip, label: "맛보기", testId: "hero-player" }));
    expect(html).toContain('data-testid="preview-poster"');
    expect(html).not.toContain("<canvas");
    expect(html).toContain("반복문 for와 while");
    expect(posterTime(clip)).toBeLessThan(clip.scenes[0].dur);
  });
});

describe("시험 달력", () => {
  it("counts down from real 2026 dates in KST", () => {
    const today = "2026-11-18";
    const by = Object.fromEntries(EXAMS.map((e) => [e.key, examStatus(e, today)]));
    expect(by.suneung).toMatchObject({ state: "upcoming", days: 1, milestone: { date: "2026-11-19" } });
    expect(by.jeongcheogi).toMatchObject({ state: "upcoming", days: 30, milestone: { date: "2026-12-18" } });
    expect(by.toeic).toMatchObject({ state: "upcoming", days: 25, milestone: { date: "2026-12-13" } });
    expect(by.realtor).toMatchObject({ state: "ended", milestone: { date: "2026-10-31" } });
    expect(examStatus(EXAMS.find((e) => e.key === "suneung")!, "2026-11-19")).toMatchObject({ days: 0 });
    expect(ddayLabel(0)).toBe("D-day");
    expect(ddayLabel(30)).toBe("D-30");
  });
});
