import Link from "next/link";
import { accessLabel, dateTimeKo, discountPct, durationKo, won } from "@/lib/format";
import { CartButton } from "./CartButton";

/** 강의·패키지 가격 상자. 수강 신청하면 장바구니에 담는다. */
export function PriceBox(props: {
  unit: number;
  list: number;
  onSale: boolean;
  saleEndsAt: string | null;
  accessDays: number | null;
  totalSec: number;
  lectureCount: number;
  inSubscription?: boolean;
  courseCode?: string;
  bundleCode?: string;
}) {
  const { unit, list, onSale, saleEndsAt } = props;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      {onSale && saleEndsAt && (
        <p className="mb-3 rounded-lg bg-lemon-300/30 px-3 py-2 text-xs font-semibold text-ink">
          할인 마감 {dateTimeKo(saleEndsAt)}까지
        </p>
      )}
      <div className="flex items-baseline gap-2">
        {onSale && <span className="text-xl font-extrabold text-rose-500">{discountPct(list, unit)}%</span>}
        <span className="price text-3xl">{won(unit)}</span>
      </div>
      {onSale && <p className="mt-1 text-sm text-slate-400 line-through">정가 {won(list)}</p>}
      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-slate-500">수강 기간</dt>
        <dd className="font-medium">{accessLabel(props.accessDays)}</dd>
        <dt className="text-slate-500">강의 구성</dt>
        <dd className="font-medium">{props.lectureCount}개 강 · {durationKo(props.totalSec)}</dd>
      </dl>
      {props.courseCode || props.bundleCode ? (
        <CartButton courseCode={props.courseCode} bundleCode={props.bundleCode} />
      ) : (
        <button type="button" disabled className="btn-primary mt-5 w-full">지금은 신청할 수 없어요</button>
      )}
      {props.inSubscription && (
        <Link href="/subscribe" className="btn-line mt-2 w-full">구독으로 듣기</Link>
      )}
      <p className="mt-3 text-center text-xs text-slate-500">결제 후 7일 이내, 진도 5% 미만이면 전액 환불돼요.</p>
    </div>
  );
}
