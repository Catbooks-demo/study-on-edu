import type { Prisma } from "@prisma/client";

/** 트랜잭션 안에서 쓰는 DB 핸들. */
export type Tx = Prisma.TransactionClient;
