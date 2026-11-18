import { type Clip, type Scene, rng, typingDone } from "./frame";

/** 화면 폭에 맞게 자르기 (한글 기준 글자 수). */
export function fit(text: string, max: number): string {
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join("")}…`;
}

/** 강의 제목에서 앞부분만 ("자바스크립트 기초 다지기: …" → 앞부분). */
export const shortTitle = (title: string) => title.split(/[:：]/)[0].trim();

function codeScene(title: string, lines: string[], dur?: number): Extract<Scene, { kind: "code" }> {
  const s: Extract<Scene, { kind: "code" }> = { kind: "code", dur: 0, title, lines };
  const done = typingDone(s);
  s.dur = dur ?? Math.ceil(done + 1.6);
  const longest = lines.reduce((a, l, i) => (l.length > lines[a].length ? i : a), 0);
  // 고정폭 17px 글자 하나 ≈ 9.4px
  s.marks = [{ kind: "circle", cx: 86 + lines[longest].length * 4.7, cy: 114 + longest * 27, rx: lines[longest].length * 4.9 + 16, ry: 17, at: done + 0.1, dur: 0.7 }];
  s.notes = [{ text: "여기가 핵심!", x: 470, y: 300, at: done + 0.6, rotate: -5 }];
  return s;
}

/** 메인 화면의 "재생 중인 강의" (12초). 슬라이드 → 코드 치기 → 차트 그리기, 손글씨 표시. */
export function heroClip(): Clip {
  const code = codeScene("반복문으로 일주일 공부 시간 더하기", [
    "minutes = [25, 40, 15, 50, 30, 45, 20]",
    "total = 0",
    "for m in minutes:",
    "    total += m",
    'print("이번 주", total, "분")',
  ]);
  return {
    label: "처음 만나는 파이썬 · 반복문 for와 while",
    seed: "hero",
    scenes: [
      {
        kind: "slide",
        dur: 3.6,
        title: "반복문 for와 while",
        bullets: ["같은 일을 여러 번 시킬 때", "for는 목록을 하나씩 꺼내요", "while은 조건이 참인 동안"],
        marks: [{ kind: "underline", x1: 60, y1: 98, x2: 300, at: 0.4 }],
      },
      code,
      {
        kind: "chart",
        dur: 3.8,
        title: "요일별 공부 시간 (분)",
        chart: "bar",
        labels: ["월", "화", "수", "목", "금", "토", "일"],
        values: [0.5, 0.8, 0.3, 1, 0.6, 0.9, 0.4],
        marks: [{ kind: "arrow", x1: 470, y1: 120, x2: 345, y2: 112, at: 1.9, dur: 0.6 }],
        notes: [{ text: "목요일 최고 기록", x: 478, y: 128, at: 2.4, rotate: -3 }],
      },
    ],
    captions: [
      { at: 0, text: "오늘은 반복문을 배워 볼게요." },
      { at: 1.8, text: "같은 일을 여러 번 해야 할 때 써요." },
      { at: 3.6, text: "일주일 공부 시간을 반복문으로 더해 봐요." },
      { at: 3.6 + code.dur * 0.6, text: "total에 하나씩 더해지는 게 보이죠?" },
      { at: 3.6 + code.dur, text: "결과를 그래프로 그리면 한눈에 보여요." },
    ],
  };
}

const BULLETS: Record<string, string[]> = {
  DEV: ["개념을 그림으로 먼저", "코드를 직접 따라 쳐요", "작은 결과물로 마무리"],
  DATA: ["데이터를 불러와 살펴보기", "질문을 숫자로 바꾸기", "그래프로 답하기"],
  CERT: ["꼭 나오는 개념만", "기출 유형으로 확인", "시험장 시간 배분까지"],
  LANG: ["듣고 따라 말하기", "장면별 핵심 표현", "바꿔 말하기 연습"],
  DSGN: ["좋은 예와 고친 예 비교", "도구는 손에 익게", "한 장 완성하기"],
  BIZ: ["지표부터 읽어요", "사례로 이해하기", "내 업무에 적용하기"],
  EXAM: ["개념이 나온 이유", "대표 유형 풀이 틀", "실수 줄이는 점검표"],
};

const CODE: Record<string, string[]> = {
  DEV: ["def greet(name):", '    return "안녕, " + name', "", 'print(greet("스터디온"))'],
  DATA: ["SELECT day, SUM(minutes)", "FROM study_log", "GROUP BY day", "ORDER BY day"],
};

function secondScene(category: string, title: string, seed: string): Scene {
  const r = rng(seed);
  const values = Array.from({ length: 6 }, () => Math.round((0.3 + r() * 0.7) * 100) / 100);
  if (category === "DEV" || (category === "DATA" && r() < 0.5)) {
    return codeScene(fit(title, 24), CODE[category] ?? CODE.DEV, 4.6);
  }
  if (category === "DATA" || category === "BIZ") {
    const line = category === "DATA";
    return {
      kind: "chart",
      dur: 4.6,
      title: fit(line ? "추이 읽기" : "핵심 지표 비교", 20),
      chart: line ? "line" : "bar",
      labels: ["1주", "2주", "3주", "4주", "5주", "6주"],
      values,
      notes: [{ text: line ? "여기서 꺾여요" : "이 막대를 봐요", x: 430, y: 104, at: 2.2 }],
      marks: [{ kind: "arrow", x1: 425, y1: 112, x2: 330, y2: 150, at: 1.8 }],
    };
  }
  if (category === "CERT" || category === "EXAM") {
    return {
      kind: "slide",
      dur: 4.6,
      title: "확인 문제",
      bullets: ["① 보기에서 옳은 것을 고르세요", "② 근거가 되는 문장을 찾아요", "③ 오답은 왜 틀렸는지 적어요"],
      marks: [{ kind: "check", x: 52, y: 186, size: 22, at: 2.2 }, { kind: "circle", cx: 200, cy: 183, rx: 150, ry: 22, at: 2.6 }],
      notes: [{ text: "정답!", x: 470, y: 196, at: 3 }],
    };
  }
  return {
    kind: "slide",
    dur: 4.6,
    title: category === "LANG" ? "오늘의 표현" : "고치기 전과 후",
    bullets: category === "LANG" ? ["Could you say that again?", "한 번 더 말해 줄래요?", "따라 말해 봐요"] : ["여백을 넉넉하게", "강조는 한 곳에만", "글자 크기에 위계를"],
    marks: [{ kind: "underline", x1: 82, y1: 154, x2: 380, at: 2 }],
    notes: [{ text: "소리 내어!", x: 470, y: 250, at: 2.6 }],
  };
}

/** 강의 카드에 마우스를 올렸을 때 도는 짧은 클립 (약 8초). 강의 코드로 정해져 같은 강의면 같은 클립. */
export function clipForCourse(c: { code: string; category: string; title: string }): Clip {
  const title = fit(shortTitle(c.title), 20);
  return {
    label: fit(c.title, 40),
    seed: c.code,
    scenes: [
      { kind: "slide", dur: 3.4, title, bullets: BULLETS[c.category] ?? BULLETS.DEV, marks: [{ kind: "underline", x1: 60, y1: 98, x2: 60 + Math.min(520, [...title].length * 27), at: 0.4 }] },
      secondScene(c.category, title, c.code),
    ],
    captions: [
      { at: 0, text: "이 강의에서 배울 것을 먼저 볼게요." },
      { at: 3.4, text: "직접 해 보면서 익혀요." },
    ],
  };
}

export interface LectureScriptLike {
  slides: { at: number; title: string; bullets: string[] }[];
  captions: { at: number; text: string }[];
}

/** 강의 상세 "맛보기": 미리보기 강의 가짜 영상 스크립트를 12초 안팎으로 줄인 클립. */
export function clipFromLecture(c: { code: string; category: string; courseTitle: string; lectureTitle: string; script: LectureScriptLike | null }): Clip {
  const slides = c.script?.slides ?? [];
  const caps = (c.script?.captions ?? []).slice(0, 4);
  const first: Scene = {
    kind: "slide",
    dur: 3.6,
    title: fit(c.lectureTitle, 20),
    bullets: (slides.slice(1, 4).map((s) => fit(s.title, 24)) as string[]).concat(slides.length < 2 ? ["이번 강에서 다룰 내용"] : []),
    marks: [{ kind: "underline", x1: 60, y1: 98, x2: 60 + Math.min(520, [...fit(c.lectureTitle, 20)].length * 27), at: 0.4 }],
  };
  const second = secondScene(c.category, c.lectureTitle, `${c.code}:preview`);
  const total = first.dur + second.dur;
  return {
    label: fit(`${shortTitle(c.courseTitle)} · ${c.lectureTitle}`, 44),
    seed: `${c.code}:preview`,
    scenes: [first, second],
    captions: caps.length
      ? caps.map((x, i) => ({ at: (i * total) / caps.length, text: fit(x.text, 30) }))
      : [{ at: 0, text: "맛보기 영상이에요." }],
  };
}
