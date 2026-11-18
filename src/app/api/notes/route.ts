import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { NOTE_MAX, addNote, listNotes, noteView } from "@/server/notes";

export const dynamic = "force-dynamic";

const body = z.object({
  lecture_id: z.string().min(1).max(40),
  at_sec: z.number().finite().min(0).max(86_400),
  body: z.string().trim().min(1, "노트 내용을 적어 주세요.").max(NOTE_MAX, "노트는 2,000자까지 적을 수 있어요."),
});

/** 내 노트 (?course_id= 로 강의 하나만). */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const courseId = new URL(req.url).searchParams.get("course_id") ?? undefined;
  const notes = await listNotes(user.id, courseId || undefined);
  return NextResponse.json({ notes: notes.map(noteView) });
});

/** 노트 쓰기 (강·시점). 수강권이 있어야 한다. */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  const input = await readJson(req, body);
  const n = await addNote(user.id, input);
  return NextResponse.json({ note: noteView(n) }, { status: 201 });
});
