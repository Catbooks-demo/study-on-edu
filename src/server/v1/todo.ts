import { HttpError } from "../http";

/**
 * 아직 dev에 없는 마일스톤의 기능에 기대는 v1 경로. 그 마일스톤이 머지되면 이 오류 대신 실제 구현을 넣는다.
 * 경로·범위·OpenAPI 설명은 미리 정해 두어 외부 시스템이 모양을 알 수 있게 한다.
 */
export function notYet(what: string, milestone: string): never {
  throw new HttpError(501, "NOT_IMPLEMENTED", `${what}은(는) 아직 준비 중이에요 (${milestone} 머지 뒤 열려요).`);
}
