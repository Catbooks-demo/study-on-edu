import type { Metadata } from "next";
import { MaintenanceNotice } from "@/components/MaintenanceNotice";
import { currentMode } from "@/server/servicemode";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "점검 중" };

export default async function MaintenancePage() {
  const m = await currentMode();
  return <MaintenanceNotice reason={m.mode === "maintenance" ? m.reason : null} />;
}
