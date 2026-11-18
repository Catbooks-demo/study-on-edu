import type { Metadata } from "next";
import { WaitingRoom } from "@/components/WaitingRoom";
import { safeNext } from "@/lib/nav";
import { QUEUE_TEXT, isTarget } from "@/server/queue";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "대기 중" };

/** 가상 대기실. `?target=site&next=/…` 또는 `?ticket=<id>&next=/…`. */
export default async function WaitingPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const target = isTarget(sp.target) ? sp.target : null;
  const ticket = sp.ticket && /^[A-Za-z0-9_-]{1,40}$/.test(sp.ticket) ? sp.ticket : null;
  return <WaitingRoom target={target} ticket={ticket} next={safeNext(sp.next, "/")} text={QUEUE_TEXT} />;
}
