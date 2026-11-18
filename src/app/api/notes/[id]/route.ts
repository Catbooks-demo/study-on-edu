import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { NOTE_MAX, deleteNote, noteView, updateNote } from "@/server/notes";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const body = z.object({ body: z.string().trim().min(1, "노트 내용을 적어 주세요.").max(NOTE_MAX, "노트는 2,000자까지 적을 수 있어요.") });

/** 노트 고치기 (본인 것만). */
export const PATCH = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  const input = await readJson(req, body);
  return NextResponse.json({ note: noteView(await updateNote(user.id, id, input.body)) });
});

/** 노트 지우기 (본인 것만). */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  await deleteNote(user.id, id);
  return NextResponse.json({ ok: true });
});
