import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DeviceList } from "@/components/DeviceList";
import { currentUser } from "@/server/auth/current";
import { DEVICE_COOKIE, DEVICE_LIMIT, deviceView, listDevices } from "@/server/devices";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "기기 관리" };

/** 기기 관리: 이름·첫/마지막 사용·해제. 계정당 2대, 동시 재생은 1개. */
export default async function DevicesPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/my/devices");
  const key = (await cookies()).get(DEVICE_COOKIE)?.value;
  const devices = (await listDevices(user.id)).map((d) => deviceView(d, key));
  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-sm"><Link href="/my" className="text-brand-600 hover:underline">마이페이지</Link></p>
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight">기기 관리</h1>
      <p className="mt-2 text-sm text-slate-600">
        한 계정에 기기를 {DEVICE_LIMIT}대까지 등록할 수 있고, 동시에 재생할 수 있는 기기는 1대예요. 새 기기에서 재생하려면 쓰지 않는 기기를 해제해 주세요.
      </p>
      <DeviceList devices={devices} />
    </div>
  );
}
