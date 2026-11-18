import type { Metadata } from "next";
import { Doc } from "@/components/Doc";

export const metadata: Metadata = { title: "개인정보 처리방침" };

export default function PrivacyTerms() {
  return (
    <Doc title="개인정보 처리방침" updated="2026년 11월 18일">
      <p>스터디온에듀는 시연용 가상 서비스예요. 실제 개인정보를 넣지 말고 시연용 정보로 가입해 주세요.</p>
      <section>
        <h2>모으는 정보와 쓰는 곳</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left"><th className="py-2">항목</th><th className="py-2">쓰는 곳</th></tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100"><td className="py-2">이메일, 비밀번호(암호화 저장), 이름, 휴대폰 번호</td><td className="py-2">회원 식별, 로그인, 주문·환불 안내</td></tr>
            <tr className="border-b border-slate-100"><td className="py-2">태어난 해, 관심 분야(선택)</td><td className="py-2">강의 추천</td></tr>
            <tr className="border-b border-slate-100"><td className="py-2">기기 식별값, 재생 기록</td><td className="py-2">기기 제한, 진도 계산, 수료증 발급, 환불액 계산</td></tr>
            <tr className="border-b border-slate-100"><td className="py-2">결제 기록(카드 번호는 저장하지 않음)</td><td className="py-2">결제·환불 처리, 강사 정산</td></tr>
          </tbody>
        </table>
      </section>
      <section>
        <h2>보관 기간</h2>
        <ul>
          <li>회원 정보는 탈퇴할 때까지 보관하고, 탈퇴하면 바로 지워요.</li>
          <li>결제·환불 기록은 관련 법령이 정한 기간 동안 따로 보관해요.</li>
        </ul>
      </section>
      <section>
        <h2>다른 곳에 주는 경우</h2>
        <p>결제 처리를 위해 결제 대행사에 필요한 최소한의 정보만 보내요. 그 밖에는 본인 동의 없이 다른 곳에 주지 않아요.</p>
      </section>
      <section>
        <h2>마케팅 수신</h2>
        <p>마케팅 정보 수신은 선택이고, 회원 정보에서 언제든 끌 수 있어요.</p>
      </section>
      <section>
        <h2>문의</h2>
        <p>개인정보 관련 문의는 고객센터에서 받아요.</p>
      </section>
    </Doc>
  );
}
