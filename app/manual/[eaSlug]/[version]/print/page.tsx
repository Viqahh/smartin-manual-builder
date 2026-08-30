import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ManualRenderer } from "@/components/manual-renderer/manual-renderer";
import { getPublicManual, PublicSnapshotCorruptError } from "@/lib/publication/get-public-manual";
import { verifyPrintToken, PRINT_TOKEN_HEADER } from "@/lib/pdf/print-token";

/**
 * Phase 7 slice 4 — the SIGNED internal print page (not a public reading route).
 *
 * Authorisation is a short-lived HMAC print token carried ONLY in the `x-smartin-print-token`
 * request header (never the URL — URLs are logged). ANY failure (missing / malformed / expired /
 * bad signature / slug or version mismatch) is a generic 404 with no reason. It renders the
 * immutable published snapshot through the ONE shared `ManualRenderer` — no navigation chrome, no
 * TOC / search / version switcher, no download button, no editing. Images resolve through the
 * Slice-3 same-origin proxy. `Referrer-Policy: no-referrer` + `X-Robots-Tag: noindex,nofollow`
 * come from `next.config.ts`; the metadata robots tag is belt.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

type RouteParams = Promise<{ eaSlug: string; version: string }>;

export default async function PrintPage({ params }: { params: RouteParams }) {
  const { eaSlug, version } = await params;
  const token = (await headers()).get(PRINT_TOKEN_HEADER);

  if (!verifyPrintToken(token, eaSlug, version)) notFound();

  let res;
  try {
    res = await getPublicManual(eaSlug, version);
  } catch (e) {
    if (e instanceof PublicSnapshotCorruptError) throw new Error("Dokumen tidak dapat ditampilkan.");
    throw e;
  }
  if (!res) notFound();

  return (
    <main className="pdf-shell">
      <ManualRenderer vm={res.vm} />
    </main>
  );
}
