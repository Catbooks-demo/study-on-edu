import { requireUser } from "@/server/auth/session";
import { HttpError, route } from "@/server/http";
import { chatSince, chatView, hasEntered, liveBeat, liveViewers } from "@/server/live";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const CHAT_EVERY_MS = 2_000;
const VIEWERS_EVERY_MS = 10_000;
const MAX_MS = 5 * 60_000;

/**
 * 라이브 채팅 SSE. 2초마다 새 채팅(event: chat), 10초마다 시청자 수(event: viewers).
 * 연결은 최대 5분이고, 브라우저(EventSource)가 다시 붙는다. Last-Event-ID로 이어 받는다.
 */
export const GET = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  if (!(await hasEntered(user.id, id))) throw new HttpError(403, "NOT_ENTERED", "라이브에 입장한 뒤에 볼 수 있어요.");
  const lastId = Number(req.headers.get("last-event-id") ?? new URL(req.url).searchParams.get("after") ?? NaN);
  let after: number | null = Number.isInteger(lastId) && lastId >= 0 ? lastId : null;
  const enc = new TextEncoder();
  const started = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (s: string) => {
        if (!closed) controller.enqueue(enc.encode(s));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* 이미 닫힘 */
        }
      };
      let lastViewers = 0;
      const tick = async () => {
        try {
          const now = new Date();
          liveBeat(id, user.id, now);
          const chats = await chatSince(id, after);
          if (chats.length) {
            after = chats[chats.length - 1].id;
            send(`id: ${after}\nevent: chat\ndata: ${JSON.stringify(await chatView(chats))}\n\n`);
          }
          if (now.getTime() - lastViewers >= VIEWERS_EVERY_MS) {
            lastViewers = now.getTime();
            send(`event: viewers\ndata: ${JSON.stringify({ viewers: liveViewers(id, now) })}\n\n`);
          }
          if (now.getTime() - started >= MAX_MS) close();
        } catch {
          close();
        }
      };
      send(`retry: 3000\n\n`);
      void tick();
      timer = setInterval(() => void tick(), CHAT_EVERY_MS);
      req.signal.addEventListener("abort", close);
    },
    cancel() {
      closed = true;
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
});
