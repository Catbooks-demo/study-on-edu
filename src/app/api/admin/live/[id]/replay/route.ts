import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/server/auth/session";
import { readJson, route } from "@/server/http";
import { attachReplay } from "@/server/live";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const body = z.object({ section_id: z.string().min(1).max(40) });

/** 끝난 라이브를 강의의 다시보기 강으로 붙인다 (권한 live). */
export const POST = route<Ctx>(async (req, { params }) => {
  const staff = await requireStaff(req, "live");
  const { id } = await params;
  const { section_id } = await readJson(req, body);
  const l = await attachReplay(`staff:${staff.id}`, id, section_id);
  return NextResponse.json({ lecture: { id: l.id, title: l.title, duration_sec: l.duration_sec } });
});
