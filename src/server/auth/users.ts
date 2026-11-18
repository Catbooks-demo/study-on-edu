import type { Instructor, InstructorUser, Staff, User } from "@prisma/client";
import { z } from "zod";
import { db } from "../db";
import { HttpError } from "../http";
import { hashPassword, verifyPassword } from "./password";
import type { InstructorAuth } from "./session";

export const phoneSchema = z
  .string()
  .transform((s) => s.replace(/[^0-9]/g, ""))
  .refine((s) => /^01[016789][0-9]{7,8}$/.test(s), "휴대폰 번호를 확인해 주세요.");

export const INTEREST_CODES = ["DEV", "DATA", "CERT", "LANG", "DSGN", "BIZ", "EXAM"] as const;

export const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email("이메일 형식을 확인해 주세요."),
  password: z.string().min(8, "비밀번호는 8자 이상으로 정해 주세요.").max(100),
  name: z.string().trim().min(1, "이름을 넣어 주세요.").max(30),
  phone: phoneSchema,
  birth_year: z.number().int().min(1900, "태어난 해를 확인해 주세요.").max(2100, "태어난 해를 확인해 주세요.").nullish(),
  interests: z.array(z.enum(INTEREST_CODES)).max(7).optional().default([]),
  marketing_opt_in: z.boolean().optional().default(false),
  agree_terms: z.literal(true, { message: "이용약관에 동의해 주세요." }),
  agree_privacy: z.literal(true, { message: "개인정보 수집·이용에 동의해 주세요." }),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, "이메일을 넣어 주세요."),
  password: z.string().min(1, "비밀번호를 넣어 주세요."),
});

export type PublicUser = Pick<User, "id" | "email" | "name" | "phone" | "birth_year" | "interests" | "marketing_opt_in">;
export const publicUser = (u: User): PublicUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  phone: u.phone,
  birth_year: u.birth_year,
  interests: u.interests,
  marketing_opt_in: u.marketing_opt_in,
});

export type PublicStaff = Pick<Staff, "id" | "email" | "name" | "role">;
export const publicStaff = (s: Staff): PublicStaff => ({ id: s.id, email: s.email, name: s.name, role: s.role });

export type PublicInstructor = {
  user: Pick<InstructorUser, "id" | "email">;
  instructor: Pick<Instructor, "id" | "slug" | "display_name" | "status">;
};
export const publicInstructor = (a: InstructorAuth): PublicInstructor => ({
  user: { id: a.user.id, email: a.user.email },
  instructor: {
    id: a.instructor.id,
    slug: a.instructor.slug,
    display_name: a.instructor.display_name,
    status: a.instructor.status,
  },
});

export async function signup(input: z.infer<typeof signupSchema>): Promise<User> {
  const exists = await db.user.findUnique({ where: { email: input.email } });
  if (exists) throw new HttpError(409, "EMAIL_TAKEN", "이미 가입한 이메일이에요.");
  try {
    return await db.user.create({
      data: {
        email: input.email,
        password_hash: await hashPassword(input.password),
        name: input.name,
        phone: input.phone,
        birth_year: input.birth_year ?? null,
        interests: input.interests,
        marketing_opt_in: input.marketing_opt_in,
      },
    });
  } catch (e) {
    // 같은 이메일로 동시에 가입하면 unique 위반이 난다
    if ((e as { code?: string }).code === "P2002") throw new HttpError(409, "EMAIL_TAKEN", "이미 가입한 이메일이에요.");
    throw e;
  }
}

const wrong = () => new HttpError(401, "WRONG_LOGIN", "이메일 또는 비밀번호가 맞지 않아요.");

export async function login(email: string, password: string): Promise<User> {
  const u = await db.user.findUnique({ where: { email } });
  if (!u || !(await verifyPassword(password, u.password_hash))) throw wrong();
  return u;
}

export async function staffLogin(email: string, password: string): Promise<Staff> {
  const s = await db.staff.findUnique({ where: { email } });
  if (!s || !s.active || !(await verifyPassword(password, s.password_hash))) throw wrong();
  return s;
}

export async function instructorLogin(email: string, password: string): Promise<InstructorAuth> {
  const u = await db.instructorUser.findUnique({ where: { email }, include: { instructor: true } });
  if (!u || !(await verifyPassword(password, u.password_hash))) throw wrong();
  const { instructor, ...user } = u;
  if (instructor.status !== "active") {
    throw new HttpError(403, "INSTRUCTOR_SUSPENDED", "활동이 멈춘 강사 계정이에요. 운영팀에 문의해 주세요.");
  }
  return { user, instructor };
}
