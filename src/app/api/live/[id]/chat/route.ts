import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { HttpError, readJson, route } from "@/server/http";
import { chatSince, chatView, hasEntered, postChat } from "@/server/live";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const body = z.object({ body: z.string().max(1000) });

/** 채팅 이어 받기 (?after=<id>). 입장한 사람만. SSE가 끊긴 브라우저의 짧은 주기 조회용. */
export const GET = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  if (!(await hasEntered(user.id, id))) throw new HttpError(403, "NOT_ENTERED", "라이브에 입장한 뒤에 볼 수 있어요.");
  const after = new URL(req.url).searchParams.get("after");
  const n = after ? Number(after) : null;
  const chats = await chatSince(id, n !== null && Number.isInteger(n) && n >= 0 ? n : null);
  return NextResponse.json({ chats: await chatView(chats) });
});

/** 채팅 쓰기 (입장한 사람만, 200자, 계정당 30회/분). */
export const POST = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  const { body: text } = await readJson(req, body);
  const c = await postChat(user.id, id, text);
  return NextResponse.json({ chat: (await chatView([c]))[0] }, { status: 201 });
});
