import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { route } from "@/server/http";
import { inboxView, listInbox, unreadCount } from "@/server/inbox";

export const dynamic = "force-dynamic";

/** 내 메시지함 (새것부터 100개)과 안 읽은 수. */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const [rows, unread] = await Promise.all([listInbox(user.id), unreadCount(user.id)]);
  return NextResponse.json({ messages: rows.map(inboxView), unread });
}, { feature: "browse" });
