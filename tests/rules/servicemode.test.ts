import { describe, expect, it } from "vitest";
import { FEATURES, MODES, allows, suggestMode } from "@/rules/servicemode";

describe("서비스 모드 규칙", () => {
  it("모드 4 × 기능 5 표", () => {
    const table = {
      normal: { browse: true, auth: true, play: true, write: true, heavy: true },
      degraded: { browse: true, auth: true, play: true, write: true, heavy: false },
      read_only: { browse: true, auth: true, play: true, write: false, heavy: false },
      maintenance: { browse: false, auth: false, play: false, write: false, heavy: false },
    } as const;
    expect([...MODES]).toEqual(["normal", "degraded", "read_only", "maintenance"]);
    expect([...FEATURES]).toEqual(["browse", "auth", "play", "write", "heavy"]);
    for (const m of MODES) for (const f of FEATURES) expect(allows(m, f), `${m}/${f}`).toBe(table[m][f]);
  });

  it("자동 제안 기준", () => {
    expect(suggestMode({ error_rate: 0.05, p95_ms: 0 })).toBe("degraded");
    expect(suggestMode({ error_rate: 0.2, p95_ms: 0 })).toBe("read_only");
    expect(suggestMode({ error_rate: 0.01, p95_ms: 1499 })).toBeNull();
    expect(suggestMode({ error_rate: 0, p95_ms: 1500 })).toBe("degraded");
    expect(suggestMode({ error_rate: 0, p95_ms: 5000 })).toBe("read_only");
    expect(suggestMode({ error_rate: 0.049, p95_ms: 4999 })).toBe("degraded");
  });
});
