"use client";

import { useState } from "react";
import { ChatPanel } from "./ChatPanel";
import { FakeBroadcast } from "./FakeBroadcast";

/** 라이브 방: 가짜 방송 + 채팅. 시청자 수는 채팅 SSE가 알려 준다. */
export function LiveRoom(props: { sessionId: string; title: string; startsAt: string; course: { code: string; category: string; title: string } | null }) {
  const [viewers, setViewers] = useState(1);
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
      <FakeBroadcast title={props.title} startsAt={props.startsAt} course={props.course} viewers={viewers} />
      <ChatPanel sessionId={props.sessionId} onViewers={setViewers} />
    </div>
  );
}
