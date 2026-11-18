/** 모든 수강생 화면 아래. 법적 번호는 지어내지 않고 빈칸 형식만 둔다. */
export function Footer() {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl space-y-1 px-4 py-8 text-xs text-slate-500">
        <p className="font-semibold text-slate-700">스터디온에듀는 시연용 가상 서비스예요. 실제 강의를 판매하지 않아요.</p>
        <p>사업자등록번호 ___-__-_____ · 원격평생교육시설 신고번호 제 ____ 호</p>
      </div>
    </footer>
  );
}
