import { NextResponse } from "next/server";
import { z } from "zod";
import { apiActor, authApiKey } from "@/server/apikeys";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { route, readJson } from "@/server/http";
import { INBOX_BATCH_MAX, INBOX_BODY_MAX, INBOX_TITLE_MAX, sendInbox, splitMembers } from "@/server/inbox";

export const dynamic = "force-dynamic";

const body = z.object({
  member_ids: z.array(z.string().min(1).max(40)).min(1, "받을 회원을 적어 주세요.").max(INBOX_BATCH_MAX, `회원은 한 번에 ${INBOX_BATCH_MAX}명까지예요.`),
  kind: z.string().trim().regex(/^[a-z_]{1,30}$/, "종류는 영문 소문자·_ 30자까지예요.").default("notice"),
  title: z.string().trim().min(1, "제목을 적어 주세요.").max(INBOX_TITLE_MAX),
  body: z.string().trim().min(1, "내용을 적어 주세요.").max(INBOX_BODY_MAX),
  link: z.string().trim().max(200).nullish(),
});

/** 회원 메시지함에 안내 보내기 (write). 돈과 상관없는 안내만. 링크는 /로 시작하는 사이트 안 경로만. */
export const POST = route(async (req) => {
  const key = await authApiKey(req, "write");
  const b = await readJson(req, body);
  const r = await db.$transaction(async (tx) => {
    const { found, missing } = await splitMembers(tx, b.member_ids);
    const sent = await sendInbox(tx, found, { kind: b.kind, title: b.title, body: b.body, link: b.link }, "api");
    return { sent, missing };
  });
  await audit(apiActor(key), "inbox.send", `inbox:${b.kind}`, { title: b.title, sent: r.sent, not_found: r.missing.length });
  return NextResponse.json({ sent: r.sent, not_found: r.missing }, { status: 201 });
});
