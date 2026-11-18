"use client";

/** 누르기 전에 한 번 더 묻는 제출 버튼 (환불 승인·키 폐기처럼 되돌리기 어려운 일). */
export function ConfirmSubmit({ label, message, className = "btn-primary" }: { label: string; message: string; className?: string }) {
  return (
    <button
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {label}
    </button>
  );
}
