import { PrismaClient } from "@prisma/client";
import { bumpSlowQuery } from "./metrics-state";

/** 이만큼 걸린 쿼리를 느린 쿼리로 센다 (지표 studyon_db_slow_queries_total). */
export const SLOW_QUERY_MS = 500;

const g = globalThis as unknown as { __studyonDb?: PrismaClient };

function create(): PrismaClient {
  const client = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
  // 쿼리 본문·값은 남기지 않고 걸린 시간만 본다
  client.$on("query", (e) => {
    if (e.duration >= SLOW_QUERY_MS) bumpSlowQuery();
  });
  return client;
}

/** 앱 전체가 쓰는 DB 연결 하나. 개발 중 새로고침에도 하나만 유지한다. */
export const db: PrismaClient = g.__studyonDb ?? create();

if (process.env.NODE_ENV !== "production") g.__studyonDb = db;
