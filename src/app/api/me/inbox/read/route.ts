import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { markRead, unreadCount } from "@/server/inbox";

export const dynamic = "force-dynamic";

const body = z.object({ ids: z.array(z.string().min(1).max(40)).max(200).optional() });

/** 읽음 표시 ({ids}가 없으면 모두). 내 메시지만 바뀐다. */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const { ids } = await readJson(req, body);
  const changed = await markRead(user.id, ids ?? null);
  return NextResponse.json({ changed, unread: await unreadCount(user.id) });
}, { feature: "write" });
