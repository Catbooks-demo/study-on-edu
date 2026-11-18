import { H, W, type Op } from "./frame";

const SANS = '"Pretendard Variable", Pretendard, "Malgun Gothic", sans-serif';
const MONO = 'Consolas, "D2Coding", ui-monospace, monospace';

/** display list를 canvas에 그린다 (브라우저 전용). */
export function paint(ctx: CanvasRenderingContext2D, ops: Op[], scale = 1): void {
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, W, H);
  for (const o of ops) {
    ctx.globalAlpha = o.opacity ?? 1;
    if (o.op === "rect") {
      ctx.fillStyle = o.fill;
      ctx.beginPath();
      if (o.r) ctx.roundRect(o.x, o.y, o.w, o.h, o.r);
      else ctx.rect(o.x, o.y, o.w, o.h);
      ctx.fill();
    } else if (o.op === "circle") {
      ctx.fillStyle = o.fill;
      ctx.beginPath();
      ctx.arc(o.cx, o.cy, o.r, 0, Math.PI * 2);
      ctx.fill();
    } else if (o.op === "text") {
      ctx.save();
      ctx.fillStyle = o.color;
      ctx.font = `${o.weight ?? 400} ${o.size}px ${o.font === "mono" ? MONO : SANS}`;
      ctx.textAlign = o.align ?? "left";
      ctx.textBaseline = "alphabetic";
      ctx.translate(o.x, o.y);
      if (o.rotate) ctx.rotate((o.rotate * Math.PI) / 180);
      ctx.fillText(o.text, 0, 0);
      ctx.restore();
    } else if (o.op === "run") {
      ctx.font = `400 ${o.size}px ${MONO}`;
      ctx.textAlign = "left";
      let x = o.x;
      for (const part of o.parts) {
        ctx.fillStyle = part.color;
        ctx.fillText(part.text, x, o.y);
        x += ctx.measureText(part.text).width;
      }
      if (o.cursor) {
        ctx.fillStyle = o.cursor;
        ctx.fillRect(x + 1, o.y - o.size + 2, o.size * 0.55, o.size + 2);
      }
    } else if (o.op === "path" && o.points.length > 1) {
      ctx.strokeStyle = o.stroke;
      ctx.lineWidth = o.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(o.points[0][0], o.points[0][1]);
      for (const [x, y] of o.points.slice(1)) ctx.lineTo(x, y);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
