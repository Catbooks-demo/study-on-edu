import type { Metadata } from "next";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "스터디온에듀 — 온라인 강의", template: "%s | 스터디온에듀" },
  description: "개발·데이터·자격증·어학·디자인·비즈니스·수능 온라인 강의. 시연용 가상 서비스입니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
