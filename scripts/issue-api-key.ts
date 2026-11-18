/**
 * API 키 발급 (직원 화면의 키 관리가 생기기 전, 서버 안에서만).
 *   npm run apikey -- --name 프로메테우스 --scopes metrics
 *   npm run apikey -- --name 관제 --scopes read,write
 * 키 원문은 이때 한 번만 화면에 나온다. DB에는 해시만 남는다. 로그 파일로 돌리지 말 것.
 */
import { SCOPES, type Scope, issueApiKey } from "../src/server/apikeys";
import { audit } from "../src/server/audit";
import { db } from "../src/server/db";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const name = arg("name");
  const scopes = (arg("scopes") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!name || !scopes.length || scopes.some((s) => !SCOPES.includes(s as Scope))) {
    console.error(`사용법: npm run apikey -- --name <이름> --scopes ${SCOPES.join(",")} 중 하나 이상`);
    process.exit(1);
  }
  const k = await issueApiKey(name, scopes as Scope[], "cli");
  await audit("system", "api_key.issue", `api_key:${k.id}`, { name, scopes, via: "cli" });
  process.stdout.write(`발급했어요 (${name}, ${scopes.join(",")}). 지금 한 번만 보여요:\n${k.key}\n`);
  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : String(e));
  await db.$disconnect();
  process.exit(1);
});
