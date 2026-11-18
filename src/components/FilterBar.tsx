import type { CourseQuery } from "@/server/catalog";

const PRICES = [
  { v: "50000", label: "5만 원 이하" },
  { v: "100000", label: "10만 원 이하" },
  { v: "150000", label: "15만 원 이하" },
];
const RATINGS = [
  { v: "4.5", label: "4.5점 이상" },
  { v: "4", label: "4점 이상" },
];
const SORT_LABEL = { popular: "인기순", newest: "최신순", rating: "평점순", price_asc: "낮은 가격순", price_desc: "높은 가격순" };

/** 강의 목록 필터 (GET 폼이라 자바스크립트 없이도 된다). */
export function FilterBar({ q, categories }: { q: CourseQuery; categories: { code: string; name: string }[] }) {
  return (
    <form action="/courses" aria-label="강의 조건" className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-3 lg:grid-cols-[repeat(5,minmax(0,1fr))_auto_auto]">
      {q.q && <input type="hidden" name="q" value={q.q} />}
      <label className="text-sm">
        <span className="label">분야</span>
        <select name="category" defaultValue={q.category ?? ""} className="field">
          <option value="">전체</option>
          {categories.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
      </label>
      <label className="text-sm">
        <span className="label">난이도</span>
        <select name="level" defaultValue={q.level ?? ""} className="field">
          <option value="">전체</option>
          <option value="beginner">입문</option>
          <option value="intermediate">중급</option>
          <option value="advanced">고급</option>
        </select>
      </label>
      <label className="text-sm">
        <span className="label">가격</span>
        <select name="priceMax" defaultValue={q.priceMax ? String(q.priceMax) : ""} className="field">
          <option value="">전체</option>
          {PRICES.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
        </select>
      </label>
      <label className="text-sm">
        <span className="label">평점</span>
        <select name="ratingMin" defaultValue={q.ratingMin ? String(q.ratingMin) : ""} className="field">
          <option value="">전체</option>
          {RATINGS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
        </select>
      </label>
      <label className="text-sm">
        <span className="label">정렬</span>
        <select name="sort" defaultValue={q.sort ?? "popular"} className="field">
          {Object.entries(SORT_LABEL).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </label>
      <label className="flex items-center gap-2 self-end pb-2.5 text-sm font-medium">
        <input type="checkbox" name="sub" value="1" defaultChecked={!!q.inSubscription} className="h-4 w-4 accent-brand-500" />
        구독 포함만
      </label>
      <button type="submit" className="btn-primary self-end">적용</button>
    </form>
  );
}
