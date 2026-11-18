import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { courseCodes } from "../prisma/seed-lib";
import { COURSES } from "../prisma/seed-data/courses";
import { INSTRUCTORS } from "../prisma/seed-data/instructors";
import { CourseThumb } from "@/components/CourseThumb";
import { InstructorAvatar } from "@/components/InstructorAvatar";
import { avatarSpec } from "@/lib/art/avatar";
import { thumbSpec, wrapTitle } from "@/lib/art/thumb";

describe("강의 썸네일 생성", () => {
  it("same code → same spec", () => {
    expect(thumbSpec("SO-DEV-0003")).toEqual(thumbSpec("SO-DEV-0003"));
  });

  it("neighbouring codes never share a layout", () => {
    const codes = courseCodes();
    for (let i = 1; i < codes.length; i++) {
      if (codes[i].split("-")[1] !== codes[i - 1].split("-")[1]) continue;
      expect(thumbSpec(codes[i]).variant, `${codes[i - 1]} / ${codes[i]}`).not.toBe(thumbSpec(codes[i - 1]).variant);
    }
  });

  it("no two seeded thumbnails render the same markup", () => {
    const codes = courseCodes();
    const html = COURSES.map((c, i) =>
      renderToStaticMarkup(createElement(CourseThumb, { code: codes[i], category: c.cat, title: c.title.split(":")[0], badge: "3시간" })),
    );
    expect(new Set(html).size).toBe(html.length);
  });

  it("thumbnail has title, badge and no external image", () => {
    const html = renderToStaticMarkup(createElement(CourseThumb, { code: "SO-DATA-0002", category: "DATA", title: "SQL 실무 쿼리 패턴", badge: "입문" }));
    expect(html).toContain("SQL 실무");
    expect(html).toContain("입문");
    expect(html).not.toMatch(/<image|href="http|src="http/);
  });

  it("wrapTitle keeps lines short and adds an ellipsis", () => {
    const lines = wrapTitle("정보처리기사 실기 프로그래밍 코드 읽기 완성", 7, 2);
    expect(lines).toHaveLength(2);
    for (const l of lines) expect([...l].length).toBeLessThanOrEqual(7);
    expect(lines[1].endsWith("…")).toBe(true);
    expect(wrapTitle("피그마 기초", 7, 2)).toEqual(["피그마 기초"]);
  });
});

describe("가상 강사 아바타", () => {
  it("deterministic from slug", () => {
    expect(avatarSpec("data-cat")).toEqual(avatarSpec("data-cat"));
    expect(avatarSpec("data-cat")).not.toEqual(avatarSpec("query-whale"));
  });

  it("20 seeded instructors look different (color, shape, rotation)", () => {
    const keys = INSTRUCTORS.map((i) => {
      const a = avatarSpec(i.slug);
      return `${a.bg}|${a.shape}|${a.rotate}`;
    });
    expect(new Set(keys).size).toBe(20);
  });

  it("labelled as a demo instructor, no photo", () => {
    const html = renderToStaticMarkup(createElement(InstructorAvatar, { slug: "pass-maker", name: "합격제조기", withBadge: true }));
    expect(html).toContain("합격제조기 아바타, 시연용 가상 강사");
    expect(html).toContain("시연용 가상 강사</span>");
    expect(html).not.toMatch(/<img|<image/);
  });
});
