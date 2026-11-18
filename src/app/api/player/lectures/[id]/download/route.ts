import { fakePdf } from "@/lib/fakepdf";
import { requireUser } from "@/server/auth/session";
import { route } from "@/server/http";
import { markDownloaded } from "@/server/player";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** 자료 받기 (가짜 PDF). 받으면 이 강은 환불 때 본 것으로 계산된다. */
export const POST = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  const lecture = await markDownloaded(user.id, id);
  const pdf = fakePdf([
    "StudyOn Edu - demo resource",
    `Lecture #${lecture.sort} (${lecture.id})`,
    "This is a placeholder PDF for the demo site.",
    "It is not real course material.",
  ]);
  return new Response(pdf as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="studyon-resource-${lecture.sort}.pdf"`,
      "cache-control": "no-store",
    },
  });
}, { feature: "play" });
