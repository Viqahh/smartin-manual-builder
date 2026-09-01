/**
 * §21 — user-facing product surfaces must not expose internal development-phase wording.
 * Engineering history in code comments / docs / tests is allowed; this scans string/JSX literals
 * in app + feature + component source (comments stripped).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["app", "features", "components"];
const BANNED = [
  /Phase\s*\d/i,
  /Phase\s*berikutnya/i,
  /akan dihubungkan/i,
  /akan disusun pada editor/i,
  /will be implemented/i,
  /coming soon/i,
];
// Pasal N is a legitimate legal reference (Perba Bappebti) — never flag it.

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.|\.spec\./.test(name)) acc.push(p);
  }
  return acc;
}

/** remove // line comments and /* block comments *​/ so engineering notes don't trip the scan */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("no user-facing internal-phase wording", () => {
  const files = ROOTS.flatMap((r) => walk(r));

  it(`scans ${"" /* count filled below */}source files`, () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("no banned phrase appears in a non-comment string/JSX literal", () => {
    const hits: string[] = [];
    for (const f of files) {
      const code = stripComments(readFileSync(f, "utf8"));
      for (const re of BANNED) {
        const m = code.match(re);
        if (m) hits.push(`${f}: ${JSON.stringify(m[0])}`);
      }
    }
    expect(hits, `internal-phase wording in user-facing source:\n${hits.join("\n")}`).toEqual([]);
  });
});
