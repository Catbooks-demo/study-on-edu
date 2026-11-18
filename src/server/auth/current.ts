import { cookies } from "next/headers";
import type { Staff, User } from "@prisma/client";
import {
  INSTRUCTOR_COOKIE,
  type InstructorAuth,
  STAFF_COOKIE,
  USER_COOKIE,
  instructorFromToken,
  staffFromToken,
  userFromToken,
} from "./session";

/** 서버 컴포넌트에서 지금 로그인한 회원. */
export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  return userFromToken(jar.get(USER_COOKIE)?.value);
}

/** 서버 컴포넌트에서 지금 로그인한 직원. */
export async function currentStaff(): Promise<Staff | null> {
  const jar = await cookies();
  return staffFromToken(jar.get(STAFF_COOKIE)?.value);
}

/** 서버 컴포넌트에서 지금 로그인한 강사 (계정과 강사 정보). */
export async function currentInstructor(): Promise<InstructorAuth | null> {
  const jar = await cookies();
  return instructorFromToken(jar.get(INSTRUCTOR_COOKIE)?.value);
}
