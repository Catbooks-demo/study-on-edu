import Link from "next/link";
import { MODE_MESSAGE } from "@/rules/servicemode";

/** 점검 화면 (maintenance 모드에서 직원이 아니면 모든 수강생 화면 대신 보인다). */
export function MaintenanceNotice({ reason }: { reason: string | null }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center" data-testid="maintenance">
      <h1 className="text-2xl font-extrabold">{MODE_MESSAGE.maintenance}</h1>
      {reason && <p className="mt-3 text-slate-600">{reason}</p>}
      <p className="mt-6 text-sm text-slate-500">
        진행 상황은 <Link href="/status" className="font-semibold text-brand-600 underline">서비스 상태</Link>에서 볼 수 있어요.
      </p>
    </div>
  );
}
