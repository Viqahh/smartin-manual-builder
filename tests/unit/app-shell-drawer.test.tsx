// @vitest-environment jsdom
/**
 * Phase 8B-5 (live audit finding) — the mobile navigation drawer renders behind a visual scrim
 * (a modal overlay) but previously let Tab escape into the page underneath it — invisible to a
 * sighted keyboard user, since the scrim covers it. It must behave like the modal it looks like:
 * `role="dialog"` + `aria-modal`, focus moves in on open, Tab/Shift+Tab cycle within it only,
 * Escape closes it, and focus returns to the button that opened it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, cleanup, screen, within, fireEvent } from "@testing-library/react";

// The real button pulls in a "use server" action -> "server-only", which isn't resolvable
// outside Next's bundler. This test is about drawer focus management, not sign-out.
vi.mock("@/app/login/sign-out-button", () => ({
  SignOutButton: () => <button type="button">Keluar</button>,
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/manuals" }));

const { AppShell } = await import("@/components/app-shell/app-shell");

beforeEach(() => {
  cleanup();
});

function renderShell() {
  render(
    <AppShell user={{ displayName: "Andi", roles: ["DEVELOPER"] }} orgName="PT Smartin Advisor Sistem">
      <p>konten</p>
    </AppShell>,
  );
}

describe("AppShell — mobile drawer focus management", () => {
  it("opening the drawer marks it as a modal dialog and moves focus inside", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Buka navigasi" }));
    const dialog = screen.getByRole("dialog", { name: "Navigasi" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Tutup navigasi" }));
  });

  it("Tab cycles within the drawer and never reaches the background trigger button", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Buka navigasi" }));
    for (let i = 0; i < 20; i++) {
      fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    }
    expect(document.activeElement?.getAttribute("aria-label")).not.toBe("Buka navigasi");
    const dialog = screen.getByRole("dialog", { name: "Navigasi" });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("Shift+Tab from the first focusable element wraps to the last", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Buka navigasi" }));
    const dialogEl = screen.getByRole("dialog", { name: "Navigasi" });
    const closeBtn = within(dialogEl).getByRole("button", { name: "Tutup navigasi" });
    expect(document.activeElement).toBe(closeBtn); // first focusable
    fireEvent.keyDown(closeBtn, { key: "Tab", shiftKey: true });
    const dialog = screen.getByRole("dialog", { name: "Navigasi" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(closeBtn);
  });

  it("Escape closes the drawer and returns focus to the trigger button", () => {
    renderShell();
    const trigger = screen.getByRole("button", { name: "Buka navigasi" });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "Navigasi" })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Navigasi" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it("the scrim click also closes the drawer", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Buka navigasi" }));
    fireEvent.click(document.querySelector(".drawer-scrim")!);
    expect(screen.queryByRole("dialog", { name: "Navigasi" })).not.toBeInTheDocument();
  });
});
