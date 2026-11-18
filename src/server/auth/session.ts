import { createHash, randomBytes } from "node:crypto";
import type { Instructor, InstructorUser, Staff, User } from "@prisma/client";
import { db } from "../db";
import { getEnv } from "../env";
import { HttpError, readCookie } from "../http";
import { type Perm, can } from "../roles";

export const USER_COOKIE = "so_session";
export const STAFF_COOKIE = "so_staff";
export const INSTRUCTOR_COOKIE = "so_instructor";
export const USER_SESSION_DAYS = 30;
export const STAFF_SESSION_HOURS = 12;
export const INSTRUCTOR_SESSION_HOURS = 12;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

/**
 * 로그인 쿠키 설정. 주소가 https이거나, 앞단 프록시가 https로 받았다고 알려 주면(x-forwarded-proto) Secure를 붙인다.
 * 운영(https) 뒤에서 http로 받는 앱도 Secure 쿠키를 내보내게 하려는 것. localhost http 개발은 Secure 없이.
 */
export function cookieOptions(maxAgeSec: number, req?: Request) {
  const proto = req?.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const secure = getEnv().APP_BASE_URL.startsWith("https://") || proto === "https";
  return { httpOnly: true, sameSite: "lax" as const, secure, path: "/", maxAge: maxAgeSec };
}

// ── 회원 ──
export async function issueUserSession(userId: string): Promise<string> {
  const token = newToken();
  await db.session.create({
    data: {
      token_hash: sha256(token),
      user_id: userId,
      expires_at: new Date(Date.now() + USER_SESSION_DAYS * 86_400_000),
    },
  });
  return token;
}

export async function userFromToken(token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const s = await db.session.findUnique({ where: { token_hash: sha256(token) }, include: { user: true } });
  if (!s || s.expires_at < new Date()) return null;
  return s.user;
}

export async function revokeUserSession(token: string | undefined): Promise<void> {
  if (token) await db.session.deleteMany({ where: { token_hash: sha256(token) } });
}

export function userFromRequest(req: Request): Promise<User | null> {
  return userFromToken(readCookie(req, USER_COOKIE));
}

export async function requireUser(req: Request): Promise<User> {
  const u = await userFromRequest(req);
  if (!u) throw new HttpError(401, "LOGIN_REQUIRED", "로그인이 필요해요.");
  return u;
}

// ── 직원 ──
export async function issueStaffSession(staffId: string): Promise<string> {
  const token = newToken();
  await db.staffSession.create({
    data: {
      token_hash: sha256(token),
      staff_id: staffId,
      expires_at: new Date(Date.now() + STAFF_SESSION_HOURS * 3_600_000),
    },
  });
  return token;
}

export async function staffFromToken(token: string | undefined): Promise<Staff | null> {
  if (!token) return null;
  const s = await db.staffSession.findUnique({ where: { token_hash: sha256(token) }, include: { staff: true } });
  if (!s || s.expires_at < new Date() || !s.staff.active) return null;
  return s.staff;
}

export async function revokeStaffSession(token: string | undefined): Promise<void> {
  if (token) await db.staffSession.deleteMany({ where: { token_hash: sha256(token) } });
}

/** 직원 확인. 없으면 401, perm을 주면 권한표(roles.ts)에 없을 때 403. */
export async function requireStaff(req: Request, perm?: Perm): Promise<Staff> {
  const s = await staffFromToken(readCookie(req, STAFF_COOKIE));
  if (!s) throw new HttpError(401, "STAFF_LOGIN_REQUIRED", "직원 로그인이 필요해요.");
  if (perm && !can(s.role, perm)) throw new HttpError(403, "FORBIDDEN", "이 작업은 권한이 없어요.");
  return s;
}

// ── 강사 ──
export type InstructorAuth = { user: InstructorUser; instructor: Instructor };

export async function issueInstructorSession(instructorUserId: string): Promise<string> {
  const token = newToken();
  await db.instructorSession.create({
    data: {
      token_hash: sha256(token),
      instructor_user_id: instructorUserId,
      expires_at: new Date(Date.now() + INSTRUCTOR_SESSION_HOURS * 3_600_000),
    },
  });
  return token;
}

export async function instructorFromToken(token: string | undefined): Promise<InstructorAuth | null> {
  if (!token) return null;
  const s = await db.instructorSession.findUnique({
    where: { token_hash: sha256(token) },
    include: { instructor_user: { include: { instructor: true } } },
  });
  if (!s || s.expires_at < new Date()) return null;
  const { instructor, ...user } = s.instructor_user;
  if (instructor.status !== "active") return null;
  return { user, instructor };
}

export async function revokeInstructorSession(token: string | undefined): Promise<void> {
  if (token) await db.instructorSession.deleteMany({ where: { token_hash: sha256(token) } });
}

export async function requireInstructor(req: Request): Promise<InstructorAuth> {
  const a = await instructorFromToken(readCookie(req, INSTRUCTOR_COOKIE));
  if (!a) throw new HttpError(401, "INSTRUCTOR_LOGIN_REQUIRED", "강사 로그인이 필요해요.");
  return a;
}
