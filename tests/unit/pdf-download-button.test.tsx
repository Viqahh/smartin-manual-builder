// @vitest-environment jsdom
/**
 * Phase 8B-6 (live audit finding) — a plain download-fetch failure (network blip) used to
 * collapse into the same terminal, disabled "PDF belum tersedia" state as a genuinely missing
 * artifact. On the public manual page there is no `retryAction`, so that was a permanent,
 * misleading dead-end for the page's primary CTA. A fetch failure must always offer its own
 * retry, distinct from the "no artifact" message, regardless of `retryAction`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { PdfDownloadButton } from "@/components/public-manual/pdf-download-button";

beforeEach(() => {
  cleanup();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("PdfDownloadButton", () => {
  it("READY: clicking downloads via fetch → blob → anchor click", async () => {
    const blob = new Blob(["%PDF-1.4"], { type: "application/pdf" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:mock"), revokeObjectURL: vi.fn() });

    render(<PdfDownloadButton href="/manual/x/1.0.0/pdf" filename="Manual_X_v1.0.0.pdf" status="READY" />);
    fireEvent.click(screen.getByRole("button", { name: /Unduh PDF/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/manual/x/1.0.0/pdf", expect.anything()));
    await waitFor(() => expect(screen.getByRole("button", { name: /Unduh PDF/i })).toBeInTheDocument());
  });

  it("a transient fetch failure shows its own retry — NOT the 'artifact missing' message", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network"));
    vi.stubGlobal("fetch", fetchMock);

    // public page: no retryAction passed, matching app/manual/[eaSlug]/[version]/page.tsx
    render(<PdfDownloadButton href="/manual/x/1.0.0/pdf" filename="Manual_X_v1.0.0.pdf" status="READY" />);
    fireEvent.click(screen.getByRole("button", { name: /Unduh PDF/i }));

    const retry = await screen.findByRole("button", { name: /coba lagi/i });
    expect(retry).not.toHaveTextContent("PDF belum tersedia");
    expect(retry).not.toBeDisabled();

    // clicking it retries the SAME download, not a regeneration RPC
    fetchMock.mockClear();
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("FAILED with no retryAction (public, artifact genuinely missing): disabled, distinct message", () => {
    render(<PdfDownloadButton href="/manual/x/1.0.0/pdf" filename="Manual_X_v1.0.0.pdf" status="FAILED" />);
    const btn = screen.getByRole("button", { name: /PDF belum tersedia/i });
    expect(btn).toBeDisabled();
  });

  it("PENDING: disabled, no fake progress", () => {
    render(<PdfDownloadButton href="/manual/x/1.0.0/pdf" filename="Manual_X_v1.0.0.pdf" status="PENDING" />);
    expect(screen.getByRole("button", { name: /Menyiapkan PDF/i })).toBeDisabled();
  });
});
