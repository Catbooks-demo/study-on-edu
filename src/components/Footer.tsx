import Link from "next/link";
import { Logo } from "./Logo";

/** 모든 수강생 화면 아래. 법적 번호는 지어내지 않고 빈칸 형식만 둔다. */
export function Footer() {
  return (
    <footer className="mt-20 border-t border-slate-200 bg-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-[1fr_auto]">
        <div className="space-y-2 text-xs text-slate-500">
          <Logo />
          <p className="pt-2 text-sm font-semibold text-slate-700">스터디온에듀는 시연용 가상 서비스예요. 실제 강의를 판매하지 않아요.</p>
          <p>강사·강의·수강평은 모두 시연용으로 만든 것이에요. 결제는 테스트 모드로만 동작해요.</p>
          <p>사업자등록번호 ___-__-_____ · 원격평생교육시설 신고번호 제 ____ 호</p>
        </div>
        <ul className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-slate-600 sm:grid-cols-1">
          <li><Link href="/terms/service" className="hover:text-brand-700">이용약관</Link></li>
          <li><Link href="/terms/privacy" className="font-semibold hover:text-brand-700">개인정보 처리방침</Link></li>
          <li><Link href="/terms/refund" className="hover:text-brand-700">환불 규정</Link></li>
          <li><Link href="/support" className="hover:text-brand-700">고객센터</Link></li>
        </ul>
      </div>
    </footer>
  );
}
