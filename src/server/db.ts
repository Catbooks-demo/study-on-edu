import { PrismaClient } from "@prisma/client";

const g = globalThis as unknown as { __studyonDb?: PrismaClient };

/** 앱 전체가 쓰는 DB 연결 하나. 개발 중 새로고침에도 하나만 유지한다. */
export const db: PrismaClient = g.__studyonDb ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") g.__studyonDb = db;
