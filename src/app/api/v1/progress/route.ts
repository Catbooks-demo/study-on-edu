import { authApiKey } from "@/server/apikeys";
import { route } from "@/server/http";
import { readPage } from "@/server/v1/paginate";
import { notYet } from "@/server/v1/todo";

export const dynamic = "force-dynamic";

/**
 * 진도 요약: 수강권마다 `{enrollment_id, course_code, member_id, progress_ratio, completed, last_watched_at}`.
 * TODO(M4): 진도 규칙(src/rules/progress.ts courseProgress)과 player.ts courseProgressFor가 dev에 머지되면 구현한다. 그 전에는 501.
 */
export const GET = route(async (req) => {
  await authApiKey(req, "read");
  readPage(req);
  notYet("진도 요약", "M4 플레이어·진도");
});
