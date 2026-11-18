import type { Metadata } from "next";
import { Doc } from "@/components/Doc";
import { REFUND_RULES, SUBSCRIPTION_REFUND_RULES } from "@/lib/refund-terms";

export const metadata: Metadata = { title: "환불 규정" };

export default function RefundTerms() {
  return (
    <Doc title="환불 규정" updated="2026년 11월 18일">
      <p>원격 교습의 반환 기준(낸 금액에서 실제 수강분을 뺀 금액)을 따르고, 수강생에게 더 유리하게 정했어요. 금액은 원 단위 아래를 수강생에게 유리하게 계산해요.</p>
      <section>
        <h2>강의·패키지</h2>
        <ul>{REFUND_RULES.map((r) => <li key={r}>{r}</li>)}</ul>
      </section>
      <section>
        <h2>구독</h2>
        <ul>{SUBSCRIPTION_REFUND_RULES.map((r) => <li key={r}>{r}</li>)}</ul>
      </section>
      <section>
        <h2>신청 방법</h2>
        <p>마이페이지의 주문 내역에서 환불을 신청할 수 있고, 신청 전에 예상 환불액과 계산 근거를 먼저 보여 드려요. 담당자가 금액을 조정하면 그 사유를 함께 알려 드려요.</p>
      </section>
    </Doc>
  );
}
