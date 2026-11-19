import Image from "next/image";

/** 스터디온에듀 로고: 학사모 S 심볼과 이름이 한 장인 이미지 (public/brand/studyon-logo.png). */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center ${className}`}>
      <Image src="/brand/studyon-logo.png" alt="스터디온에듀" width={528} height={120} unoptimized priority className="h-9 w-auto" />
    </span>
  );
}
