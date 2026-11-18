import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ProfileForm } from "@/components/ProfileForm";
import { currentUser } from "@/server/auth/current";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "회원 정보" };

export default async function ProfilePage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/my/profile");
  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <p className="text-sm"><Link href="/my" className="text-brand-600 hover:underline">마이페이지</Link></p>
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight">회원 정보</h1>
      <ProfileForm
        email={user.email}
        initial={{ name: user.name, phone: user.phone, birth_year: user.birth_year, interests: user.interests, marketing_opt_in: user.marketing_opt_in }}
      />
    </div>
  );
}
