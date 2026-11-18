import type { Metadata } from "next";
import Link from "next/link";
import { Doc } from "@/components/Doc";

export const metadata: Metadata = { title: "이용약관" };

export default function ServiceTerms() {
  return (
    <Doc title="이용약관" updated="2026년 11월 18일">
      <p>스터디온에듀는 온라인 강의 플랫폼을 시연하기 위해 만든 가상 서비스예요. 실제 강의를 판매하지 않고, 결제는 테스트 모드로만 동작해요.</p>
      <section>
        <h2>제1조 목적</h2>
        <p>이 약관은 스터디온에듀(이하 “서비스”)가 제공하는 온라인 강의·구독·라이브 기능을 이용하는 조건과 절차를 정해요.</p>
      </section>
      <section>
        <h2>제2조 회원 가입과 계정</h2>
        <ul>
          <li>회원은 이메일과 비밀번호로 가입하고, 계정 정보를 직접 관리해요.</li>
          <li>계정은 본인만 쓸 수 있고, 다른 사람에게 빌려주거나 함께 쓸 수 없어요.</li>
          <li>강의는 계정당 기기 2대에서 볼 수 있고, 동시에 재생할 수 있는 기기는 1대예요.</li>
        </ul>
      </section>
      <section>
        <h2>제3조 수강권</h2>
        <ul>
          <li>강의를 사면 결제한 때부터 강의마다 정한 수강 기간(기본 1년, 평생 강의 포함) 동안 들을 수 있어요.</li>
          <li>구독 회원은 구독하는 동안 구독 대상 강의를 모두 들을 수 있어요. 구독이 끝나면 구독으로 듣던 강의는 볼 수 없지만 진도는 남아요.</li>
        </ul>
      </section>
      <section>
        <h2>제4조 결제와 환불</h2>
        <p>결제와 환불은 <Link href="/terms/refund" className="text-brand-700 underline">환불 규정</Link>을 따라요.</p>
      </section>
      <section>
        <h2>제5조 이용 제한</h2>
        <ul>
          <li>강의 영상·자료를 무단으로 녹화·복제·배포하면 이용이 제한될 수 있어요.</li>
          <li>질문·수강평·라이브 채팅에서 다른 사람을 비방하거나 광고를 올리면 글이 가려질 수 있어요.</li>
          <li>서비스 안정을 위해 짧은 시간에 많은 요청을 보내면 잠시 요청이 막힐 수 있어요.</li>
        </ul>
      </section>
      <section>
        <h2>제6조 서비스 변경과 중단</h2>
        <p>점검이나 장애가 있으면 서비스 일부 또는 전부가 잠시 멈출 수 있고, 이때는 화면 배너와 상태 페이지로 알려 드려요.</p>
      </section>
    </Doc>
  );
}
