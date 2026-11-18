import type { Incident } from "@prisma/client";
import { z } from "zod";
import { audit } from "./audit";
import { db } from "./db";
import { HttpError } from "./http";
import { log } from "./log";

/** 상태 페이지 구성요소 (이 순서로 보여 준다). */
export const COMPONENTS = ["web", "player", "payments", "live", "api"] as const;
export type Component = (typeof COMPONENTS)[number];
export const COMPONENT_LABEL: Record<Component, string> = {
  web: "웹사이트",
  player: "강의 재생",
  payments: "결제",
  live: "라이브",
  api: "외부 API",
};

export type ComponentState = "operational" | "degraded" | "outage";
export const STATUS_LABEL: Record<ComponentState, string> = {
  operational: "정상이에요",
  degraded: "느려요",
  outage: "장애가 있어요",
};

export const SEVERITIES = ["degraded", "outage"] as const;
export const INCIDENT_STATUSES = ["investigating", "identified", "monitoring", "resolved"] as const;
export const INCIDENT_STATUS_LABEL: Record<(typeof INCIDENT_STATUSES)[number], string> = {
  investigating: "원인을 찾고 있어요",
  identified: "원인을 찾았어요",
  monitoring: "고친 뒤 지켜보고 있어요",
  resolved: "해결했어요",
};

export type IncidentBrief = { id: string; title: string; severity: string; status: string; started_at: string };
export type ComponentRow = { component: Component; status: ComponentState; incident?: IncidentBrief };

const rank = (s: string) => (s === "outage" ? 2 : s === "degraded" ? 1 : 0);
const brief = (i: Incident): IncidentBrief => ({
  id: i.id,
  title: i.title,
  severity: i.severity,
  status: i.status,
  started_at: i.started_at.toISOString(),
});

/**
 * 구성요소별 상태: 열린(해결 전) 장애 공지 중 가장 나쁜 severity를 쓴다.
 * DB에 닿지 않으면 모두 outage로 본다.
 */
export async function componentStatus(now: Date): Promise<ComponentRow[]> {
  void now;
  let open: Incident[];
  try {
    await db.$queryRaw`SELECT 1`;
    open = await db.incident.findMany({ where: { status: { not: "resolved" } }, orderBy: { started_at: "asc" } });
  } catch (e) {
    log.error("상태 페이지: DB 연결 실패", { error: e instanceof Error ? e.message : String(e) });
    return COMPONENTS.map((component) => ({ component, status: "outage" as const }));
  }
  return COMPONENTS.map((component) => {
    const mine = open.filter((i) => i.components.includes(component));
    const worst = mine.reduce<Incident | null>((w, i) => (!w || rank(i.severity) > rank(w.severity) ? i : w), null);
    if (!worst) return { component, status: "operational" as const };
    return { component, status: worst.severity === "outage" ? ("outage" as const) : ("degraded" as const), incident: brief(worst) };
  });
}

export const incidentInput = z.object({
  title: z.string().trim().min(1, "제목을 적어 주세요.").max(100),
  body: z.string().trim().min(1, "내용을 적어 주세요.").max(2000),
  components: z.array(z.enum(COMPONENTS)).min(1, "영향 받는 구성요소를 하나 이상 골라 주세요."),
  severity: z.enum(SEVERITIES),
});
export const incidentUpdate = z.object({
  status: z.enum(INCIDENT_STATUSES),
  body: z.string().trim().min(1, "내용을 적어 주세요.").max(2000).optional(),
});

function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) throw new HttpError(400, "BAD_INPUT", r.error.issues[0]?.message ?? "입력값을 확인해 주세요.");
  return r.data;
}

/** 장애 공지 쓰기. actor: `staff:<id>` 또는 `api:<키 이름>`. */
export async function createIncident(actor: string, input: z.input<typeof incidentInput>, now: Date = new Date()): Promise<Incident> {
  const v = parse(incidentInput, input);
  return db.$transaction(async (tx) => {
    const inc = await tx.incident.create({
      data: { title: v.title, body: v.body, components: [...new Set(v.components)], severity: v.severity, started_at: now },
    });
    await audit(actor, "incident.create", `incident:${inc.id}`, { severity: v.severity, components: inc.components }, tx);
    return inc;
  });
}

/** 장애 공지 고치기 (상태·새 안내 문구). resolved가 되면 끝난 시각을 남긴다. */
export async function updateIncident(actor: string, id: string, input: z.input<typeof incidentUpdate>, now: Date = new Date()): Promise<Incident> {
  const v = parse(incidentUpdate, input);
  return db.$transaction(async (tx) => {
    const cur = await tx.incident.findUnique({ where: { id } });
    if (!cur) throw new HttpError(404, "NOT_FOUND", "장애 공지를 찾지 못했어요.");
    const out = await tx.incident.update({
      where: { id },
      data: {
        status: v.status,
        body: v.body ?? cur.body,
        resolved_at: v.status === "resolved" ? cur.resolved_at ?? now : null,
      },
    });
    await audit(actor, "incident.update", `incident:${id}`, { from: cur.status, to: v.status }, tx);
    return out;
  });
}

/** 상태 페이지·직원 화면용: 열린 공지 전부와 최근 7일 안에 해결된 공지. */
export async function listIncidents(now: Date, opts: { days?: number } = {}): Promise<Incident[]> {
  const since = new Date(now.getTime() - (opts.days ?? 7) * 86_400_000);
  return db.incident.findMany({
    where: { OR: [{ status: { not: "resolved" } }, { resolved_at: { gte: since } }] },
    orderBy: { started_at: "desc" },
    take: 50,
  });
}

export const incidentView = (i: Incident) => ({
  id: i.id,
  title: i.title,
  body: i.body,
  components: i.components,
  severity: i.severity,
  status: i.status,
  started_at: i.started_at.toISOString(),
  resolved_at: i.resolved_at?.toISOString() ?? null,
  updated_at: i.updated_at.toISOString(),
});
