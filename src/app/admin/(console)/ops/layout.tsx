import { guard } from "../guard";

export const dynamic = "force-dynamic";

/** 운영 화면 (admin만: 대기열·서비스 모드·장애 공지·지표). 메뉴는 콘솔 공통 nav.ts의 "운영" 묶음. */
export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  await guard("ops");
  return <>{children}</>;
}
