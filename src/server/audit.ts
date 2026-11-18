import type { Prisma } from "@prisma/client";
import { db } from "./db";
import type { Tx } from "./tx";

/** 관리 작업 기록. actor 형식: `staff:<id>`·`instructor:<id>`·`api:<키 이름>`·`system`. */
export async function audit(actor: string, action: string, target: string, detail?: Prisma.InputJsonValue, tx?: Tx): Promise<void> {
  await (tx ?? db).auditLog.create({ data: { actor, action, target, detail } });
}
