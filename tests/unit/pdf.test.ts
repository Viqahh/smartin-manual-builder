/**
 * Phase 7 slice 4 — PDF export building blocks (spec §36/§49/§22/§24).
 *
 * HMAC print token (sign / verify / expiry / tamper), SSRF-safe trusted origin, download
 * filename, and byte-length-preserving PDF metadata normalisation.
 */

import { describe, it, expect } from "vitest";
import {
  signPrintToken,
  verifyPrintToken,
  PRINT_TOKEN_TTL_MS,
  PRINT_TOKEN_HEADER,
} from "@/lib/pdf/print-token";
import { resolveTrustedPrintOrigin, buildPrintUrl } from "@/lib/pdf/print-origin";
import { pdfFilename, contentDisposition } from "@/lib/pdf/filename";
import { normalizePdf } from "@/lib/pdf/normalize";
import {
  pdfArtifactStorageKey,
  sha256Hex,
  PDF_ARTIFACT_BUCKET,
  PDF_ARTIFACT_VERSION,
} from "@/lib/pdf/artifact-key";

describe("print token", () => {
  const now = 1_800_000_000_000;

  it("a fresh token verifies for its exact slug + version", () => {
    const t = signPrintToken("vmax-ea", "1.0.0", now);
    expect(verifyPrintToken(t, "vmax-ea", "1.0.0", now + 1_000)).toBe(true);
  });

  it("TTL is ~120 s and an expired token is rejected", () => {
    expect(PRINT_TOKEN_TTL_MS).toBe(120_000);
    const t = signPrintToken("vmax-ea", "1.0.0", now);
    expect(verifyPrintToken(t, "vmax-ea", "1.0.0", now + PRINT_TOKEN_TTL_MS - 1)).toBe(true);
    expect(verifyPrintToken(t, "vmax-ea", "1.0.0", now + PRINT_TOKEN_TTL_MS + 1)).toBe(false);
  });

  it("rejects a slug / version mismatch (the token binds both)", () => {
    const t = signPrintToken("vmax-ea", "1.0.0", now);
    expect(verifyPrintToken(t, "other-ea", "1.0.0", now + 1)).toBe(false);
    expect(verifyPrintToken(t, "vmax-ea", "2.0.0", now + 1)).toBe(false);
  });

  it("rejects a tampered expiry and a tampered signature", () => {
    const t = signPrintToken("vmax-ea", "1.0.0", now);
    const [exp, sig] = t.split(".");
    expect(verifyPrintToken(`${Number(exp) + 999_999}.${sig}`, "vmax-ea", "1.0.0", now + 1)).toBe(false); // moved exp
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1); // same length, guaranteed different
    expect(verifyPrintToken(`${exp}.${flipped}`, "vmax-ea", "1.0.0", now + 1)).toBe(false);
  });

  it("rejects missing / malformed tokens", () => {
    for (const bad of [undefined, null, "", "no-dot", ".", "abc.", "1.2.3", 123, {}, "x".repeat(600)]) {
      expect(verifyPrintToken(bad, "vmax-ea", "1.0.0", now)).toBe(false);
    }
  });

  it("a slug containing a `.` or `/` cannot be confused with a different one", () => {
    const t = signPrintToken("a.b", "1.0.0", now);
    expect(verifyPrintToken(t, "a.b", "1.0.0", now + 1)).toBe(true);
    expect(verifyPrintToken(t, "a", "b/1.0.0", now + 1)).toBe(false); // canon() percent-encodes the parts
  });

  it("is transported by a dedicated header, distinct from the Vercel bypass header", () => {
    expect(PRINT_TOKEN_HEADER).toBe("x-smartin-print-token");
    expect(PRINT_TOKEN_HEADER).not.toBe("x-vercel-protection-bypass");
  });
});

describe("trusted print origin (SSRF)", () => {
  const withEnv = (env: Record<string, string | undefined>, fn: () => void) => {
    const keys = ["VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_ENV", "VERCEL_PROJECT_PRODUCTION_URL", "APP_URL"];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    for (const k of keys) delete process.env[k];
    Object.assign(process.env, env);
    try {
      fn();
    } finally {
      for (const k of keys) delete process.env[k];
      Object.assign(process.env, saved);
    }
  };

  it("uses VERCEL_URL when it is a *.vercel.app host", () => {
    withEnv({ VERCEL_URL: "smartin-abc123.vercel.app" }, () => {
      expect(resolveTrustedPrintOrigin()).toBe("https://smartin-abc123.vercel.app");
    });
  });

  it("falls back to a validated APP_URL locally", () => {
    withEnv({ APP_URL: "http://localhost:3100/" }, () => {
      expect(resolveTrustedPrintOrigin()).toBe("http://localhost:3100");
    });
  });

  it("ignores a hostile VERCEL_URL that is not a vercel.app host", () => {
    withEnv({ VERCEL_URL: "evil.example.com", APP_URL: "http://localhost:3100" }, () => {
      expect(resolveTrustedPrintOrigin()).toBe("http://localhost:3100");
    });
    withEnv({ VERCEL_URL: "attacker.vercel.app.evil.com", APP_URL: "http://localhost:3100" }, () => {
      expect(resolveTrustedPrintOrigin()).toBe("http://localhost:3100");
    });
  });

  it("throws when nothing trusted is configured (never a caller Host header)", () => {
    withEnv({}, () => expect(() => resolveTrustedPrintOrigin()).toThrow());
    withEnv({ APP_URL: "not-a-url" }, () => expect(() => resolveTrustedPrintOrigin()).toThrow());
  });

  it("buildPrintUrl is the clean print path with encoded params and NO query string / credential", () => {
    withEnv({ APP_URL: "http://localhost:3100" }, () => {
      const u = buildPrintUrl("vmax ea/x", "1.0.0");
      expect(u).toBe("http://localhost:3100/manual/vmax%20ea%2Fx/1.0.0/print");
      expect(new URL(u).search).toBe(""); // token travels in a header, never the URL
      expect(new URL(u).host).toBe("localhost:3100");
    });
  });
});

describe("pdf filename", () => {
  it("matches Manual_<EAName>_v<X.Y.Z>.pdf", () => {
    expect(pdfFilename("VMax EA", "1.0.0")).toBe("Manual_VMax_EA_v1.0.0.pdf");
    expect(pdfFilename("Alpha  Beta", "2.3.10")).toBe("Manual_Alpha_Beta_v2.3.10.pdf");
  });

  it("strips CR/LF/quote/slash and other Content-Disposition-unsafe chars", () => {
    expect(pdfFilename('bad"name/here\\x', "1.0.0")).toBe("Manual_badnameherex_v1.0.0.pdf");
    expect(pdfFilename("a\r\nb\tc", "1.0.0")).toBe("Manual_a_b_c_v1.0.0.pdf");
    expect(pdfFilename("*?<>|:name", "1.0.0")).toBe("Manual_name_v1.0.0.pdf");
  });

  it("falls back for empty name / bad version", () => {
    expect(pdfFilename("", "1.0.0")).toBe("Manual_EA_v1.0.0.pdf");
    expect(pdfFilename("EA", "not-a-version")).toBe("Manual_EA_v0.0.0.pdf");
    expect(pdfFilename("EA", "v1.2.3")).toBe("Manual_EA_v1.2.3.pdf");
  });

  it("contentDisposition is a safe attachment header (no raw CR/LF/quote)", () => {
    const cd = contentDisposition(pdfFilename("Bên Trần EA", "1.0.0"));
    expect(cd.startsWith("attachment; ")).toBe(true);
    expect(cd).not.toMatch(/[\r\n]/);
    expect(cd).toContain('filename="Manual_B_n_Tr_n_EA_v1.0.0.pdf"');
    expect(cd).toContain("filename*=UTF-8''");
  });
});

describe("pdf normalize", () => {
  const withDates = (creation: string, mod: string, id: string) =>
    Buffer.from(
      `%PDF-1.4\n1 0 obj<</Producer(Skia/PDF m151)/CreationDate(${creation})/ModDate(${mod})>>endobj\n` +
        `trailer <</Size 5 /Root 2 0 R /Info 1 0 R /ID [<${id}><${id}>]>>\n%%EOF`,
    );

  it("rewrites CreationDate + ModDate to a fixed value from publishedAt and zeros the file ID", () => {
    const a = normalizePdf(withDates("D:20260830120000+00'00'", "D:20260830120000+00'00'", "abcdef01"), "2026-01-02T03:04:05Z");
    const b = normalizePdf(withDates("D:20991231235959+00'00'", "D:20991231235959+00'00'", "99999999"), "2026-01-02T03:04:05Z");
    expect(a.bytes.equals(b.bytes)).toBe(true); // volatile fields gone -> identical
    expect(a.bytes.toString("latin1")).toContain("D:20260102030405+00'00'");
    expect(a.bytes.toString("latin1")).toContain("<00000000><00000000>");
    expect(a.changed).toEqual({ creationDate: true, modDate: true, fileId: true });
  });

  it("byte length is preserved (xref offsets stay valid)", () => {
    const raw = withDates("D:20260830120000+00'00'", "D:20260830120000+00'00'", "abcdef01");
    expect(normalizePdf(raw, "2026-01-02T03:04:05Z").bytes.byteLength).toBe(raw.byteLength);
  });

  it("no file ID present (Skia) is not a determinism warning", () => {
    const raw = Buffer.from(`%PDF-1.4\n1 0 obj<</CreationDate(D:20260830120000+00'00')>>endobj\ntrailer <</Size 5>>\n%%EOF`);
    const { changed } = normalizePdf(raw, "2026-01-02T03:04:05Z");
    expect(changed.fileId).toBe(true); // "nothing to do" counts as done
  });
});

describe("pdf artifact key (slice 4B)", () => {
  const HASH = "0123456789abcdef".repeat(4); // 64 hex

  it("is content-addressed on the frozen snapshot hash + pipeline version — no uuid, no user input", () => {
    expect(pdfArtifactStorageKey(HASH)).toBe(`pdf/v${PDF_ARTIFACT_VERSION}/${HASH}.pdf`);
    expect(pdfArtifactStorageKey(HASH, 2)).toBe(`pdf/v2/${HASH}.pdf`);
    expect(PDF_ARTIFACT_BUCKET).toBe("manual-pdf-artifacts");
  });

  it("matches the exact shape the complete RPC enforces", () => {
    expect(pdfArtifactStorageKey(HASH)).toMatch(/^pdf\/v[0-9]+\/[0-9a-f]{64}\.pdf$/);
  });

  it("rejects a non-64-hex hash and a bad version", () => {
    expect(() => pdfArtifactStorageKey("nope")).toThrow();
    expect(() => pdfArtifactStorageKey(HASH.toUpperCase())).toThrow(); // must be lowercase
    expect(() => pdfArtifactStorageKey(HASH + "0")).toThrow();
    expect(() => pdfArtifactStorageKey(HASH, 0)).toThrow();
  });

  it("sha256Hex is 64 lowercase hex and stable", () => {
    const h = sha256Hex(new Uint8Array([1, 2, 3]));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(new Uint8Array([1, 2, 3]))).toBe(h);
    expect(sha256Hex(new Uint8Array([1, 2, 4]))).not.toBe(h);
  });
});
