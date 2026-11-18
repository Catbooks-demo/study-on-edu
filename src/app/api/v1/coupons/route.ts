import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiActor, authApiKey } from "@/server/apikeys";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { HttpError, readJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

const body = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/, "코드는 영문 대문자·숫자·-·_ 3~30자예요."),
    name: z.string().trim().max(60).default(""),
    kind: z.enum(["fixed", "percent"]),
    value: z.number().int().positive(),
    max_discount: z.number().int().positive().nullish(),
    min_amount: z.number().int().positive().nullish(),
    target: z.enum(["all", "category", "course", "instructor"]).default("all"),
    target_ref: z.string().trim().max(60).nullish(),
    per_user_once: z.boolean().default(false),
    total_limit: z.number().int().positive().nullish(),
    starts_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }),
    referral: z.literal(false).optional(),
  })
  .refine((b) => b.kind !== "percent" || b.value <= 100, { message: "정률 할인은 100% 이하예요." })
  .refine((b) => b.target === "all" || !!b.target_ref, { message: "대상(target_ref)을 적어 주세요." })
  .refine((b) => new Date(b.ends_at) > new Date(b.starts_at), { message: "끝나는 시각이 시작보다 뒤여야 해요." });

/** 쿠폰 만들기 (write). 강사 추천 코드(referral)는 API로 만들 수 없다. */
export const POST = route(async (req) => {
  const key = await authApiKey(req, "write");
  const raw = await req.clone().json().catch(() => null);
  if (raw && typeof raw === "object" && "referral" in raw && (raw as { referral: unknown }).referral) {
    throw new HttpError(400, "REFERRAL_NOT_ALLOWED", "추천 코드(강사 쿠폰)는 API로 만들 수 없어요.");
  }
  const b = await readJson(req, body);
  try {
    const c = await db.$transaction(async (tx) => {
      const row = await tx.coupon.create({
        data: {
          code: b.code,
          name: b.name,
          kind: b.kind,
          value: b.value,
          max_discount: b.max_discount ?? null,
          min_amount: b.min_amount ?? null,
          target: b.target,
          target_ref: b.target === "all" ? null : b.target_ref,
          per_user_once: b.per_user_once,
          total_limit: b.total_limit ?? null,
          starts_at: new Date(b.starts_at),
          ends_at: new Date(b.ends_at),
          referral: false,
        },
      });
      await audit(apiActor(key), "coupon.create", `coupon:${row.id}`, { code: row.code }, tx);
      return row;
    });
    return NextResponse.json(
      { coupon: { id: c.id, code: c.code, kind: c.kind, value: c.value, starts_at: c.starts_at.toISOString(), ends_at: c.ends_at.toISOString() } },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new HttpError(409, "DUPLICATE_CODE", "이미 있는 쿠폰 코드예요.");
    }
    throw e;
  }
});
