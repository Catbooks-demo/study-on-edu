import { won as wonFmt } from "@/lib/format";
import type { Tx } from "./tx";

/** 메일 발송 대신 보낸 편지함에 기록한다(실제로 보내지 않음). 본문 앞에 [스터디온에듀]를 붙인다. */
export async function recordMessage(
  tx: Tx,
  user: { id: string; email: string },
  kind: string,
  subject: string,
  body: string,
): Promise<void> {
  await tx.message.create({
    data: { user_id: user.id, channel: "email", to: user.email, kind, subject, body: `[스터디온에듀] ${body}` },
  });
}

/** 같은 사람에게 같은 종류 안내를 이미 보냈는지. */
export async function alreadySent(tx: Tx, userId: string, kind: string): Promise<boolean> {
  return (await tx.message.count({ where: { user_id: userId, kind } })) > 0;
}

export const won = wonFmt;
