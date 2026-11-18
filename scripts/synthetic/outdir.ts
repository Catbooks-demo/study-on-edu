/** 정답지·회원 표·매일 모드 상태를 두는 곳(--out). 저장소에 올라가지 않는 곳에만 쓴다. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_OUT = "synthetic-out";

export const FILES = {
  answerKey: "answer_key.json",
  personas: "member_personas.csv",
  state: "daily_state.json",
  dailyKey: "daily_answer_key.jsonl",
  lock: "daily.lock",
  traffic: "traffic.jsonl",
} as const;

/**
 * --out이 괜찮은지. 저장소 밖이면 괜찮다. 저장소 안이면 맨 위 폴더가 .gitignore에 폴더로 적혀 있어야 한다
 * (예: `synthetic-out/`). 문제가 있으면 이유를, 없으면 null.
 */
export function outDirProblem(out: string, repoRoot: string, gitignore: string): string | null {
  const abs = path.resolve(repoRoot, out);
  const rel = path.relative(repoRoot, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null; // 저장소 밖
  if (rel === "") return "--out이 저장소 맨 위예요. 정답지는 저장소에 두지 않아요.";
  const top = rel.split(path.sep)[0];
  const ignored = gitignore
    .split(/\r?\n/)
    .map((l) => l.trim())
    .some((l) => l === `${top}/` || l === `/${top}/` || l === `/${top}`);
  return ignored ? null : `--out(${rel})이 저장소 안인데 .gitignore에 "${top}/"가 없어요. 정답지는 커밋하지 않아요.`;
}

/** --out(지금 폴더 기준)을 절대 경로로 바꾸고 확인한 뒤 만든다. 기본은 저장소의 synthetic-out/(.gitignore). */
export function resolveOut(out?: string): string {
  const abs = out ? path.resolve(out) : path.join(REPO_ROOT, DEFAULT_OUT);
  const gi = existsSync(path.join(REPO_ROOT, ".gitignore")) ? readFileSync(path.join(REPO_ROOT, ".gitignore"), "utf-8") : "";
  const problem = outDirProblem(abs, REPO_ROOT, gi);
  if (problem) throw new Error(problem);
  mkdirSync(abs, { recursive: true });
  return abs;
}

/** 임시 파일에 쓴 뒤 바꿔 끼운다 (쓰다 끊겨도 앞 파일이 남는다). */
export function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text, "utf-8");
  renameSync(tmp, file);
}

export function readJson<T>(file: string): T | null {
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf-8")) as T;
}

export function csvLine(values: (string | number | boolean | null)[]): string {
  return values
    .map((v) => {
      const s = v === null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(",");
}
