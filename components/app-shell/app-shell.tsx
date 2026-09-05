"use client";

import {
  Bell,
  BookCheck,
  BookOpenText,
  Boxes,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  Menu,
  Search,
  Settings,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SignOutButton } from "@/app/login/sign-out-button";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const ROLE_LABEL: Record<string, string> = {
  DEVELOPER: "Developer",
  TECHNICAL_REVIEWER: "Technical Reviewer",
  COMPLIANCE_REVIEWER: "Compliance Reviewer",
  ADMIN: "Admin",
};

export type ShellUser = { displayName: string; roles: string[] } | null;

const navGroups = [
  {
    label: "Workspace",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/ea-products", label: "Produk EA", icon: Boxes },
    ],
  },
  {
    label: "Dokumentasi",
    items: [
      { href: "/manuals", label: "Manual Book", icon: FileText },
      { href: "/templates", label: "Template Manual", icon: BookOpenText },
    ],
  },
  {
    label: "Review",
    items: [
      { href: "/reviews/technical", label: "Review Teknis", icon: Users },
      { href: "/reviews/compliance", label: "Review Kepatuhan", icon: ShieldCheck },
    ],
  },
  {
    label: "Sumber Daya",
    items: [
      { href: "/resources/guide", label: "Panduan Dokumentasi", icon: CircleHelp },
      { href: "/resources/compliance", label: "Referensi Kepatuhan", icon: ClipboardCheck },
    ],
  },
];

function Sidebar({
  onNavigate,
  user,
  orgName,
}: {
  onNavigate?: () => void;
  user: ShellUser;
  orgName: string | null;
}) {
  const pathname = usePathname();
  const initials = (user?.displayName ?? "S M")
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <aside className="sidebar" aria-label="Navigasi utama">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">S</span>
        <span>
          <strong>SMARTIN</strong>
          <small>{orgName ?? "Manual Builder"}</small>
        </span>
      </div>
      <nav className="sidebar-nav">
        {navGroups.map((group) => (
          <div className="nav-group" key={group.label}>
            <p>{group.label}</p>
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  className="nav-item"
                  data-active={active}
                  href={item.href}
                  key={item.href}
                  onClick={onNavigate}
                >
                  <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <Link className="nav-item" data-active={pathname === "/settings"} href="/settings" onClick={onNavigate}>
          <Settings aria-hidden="true" size={18} strokeWidth={1.8} />
          Pengaturan
        </Link>
        {user ? (
          <div className="sidebar-user">
            <span className="avatar">{initials || "S"}</span>
            <span>
              <strong>{user.displayName}</strong>
              <small>{user.roles.map((r) => ROLE_LABEL[r] ?? r).join(" · ")}</small>
            </span>
            <SignOutButton className="icon-button" />
          </div>
        ) : (
          <div className="sidebar-user">
            <span className="avatar" aria-hidden="true">
              <ChevronDown size={16} />
            </span>
            <span>
              <strong>Belum masuk</strong>
              <small>Mode setup</small>
            </span>
          </div>
        )}
      </div>
    </aside>
  );
}

export function AppShell({
  children,
  user,
  orgName,
}: {
  children: React.ReactNode;
  user: ShellUser;
  orgName: string | null;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  // Phase 8B-5 (live audit finding) — the mobile drawer renders behind a visual scrim but
  // previously let Tab escape into the page underneath it (invisible, unreachable by sighted
  // keyboard users). It is a modal overlay, so it must trap focus like one: Tab/Shift+Tab cycle
  // within the drawer only, opening it moves focus in, and closing it returns focus to the
  // trigger button that opened it.
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setMenuOpen(false);
    const trapTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !menuRef.current) return;
      const focusable = Array.from(menuRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey ? active === first || !menuRef.current.contains(active) : active === last) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("keydown", trapTab);
    const toFocus = menuRef.current?.querySelector<HTMLElement>(".drawer-close");
    toFocus?.focus();
    const trigger = menuTriggerRef.current;
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("keydown", trapTab);
      trigger?.focus();
    };
  }, [menuOpen]);

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">Lewati ke konten utama</a>
      <div className="desktop-sidebar"><Sidebar user={user} orgName={orgName} /></div>
      {menuOpen && (
        <div className="drawer-layer" role="presentation">
          <button className="drawer-scrim" aria-label="Tutup navigasi" onClick={() => setMenuOpen(false)} />
          <div className="mobile-sidebar" ref={menuRef} role="dialog" aria-modal="true" aria-label="Navigasi">
            <button className="icon-button drawer-close" aria-label="Tutup navigasi" onClick={() => setMenuOpen(false)}>
              <X aria-hidden="true" size={20} />
            </button>
            <Sidebar onNavigate={() => setMenuOpen(false)} user={user} orgName={orgName} />
          </div>
        </div>
      )}
      <div className="workspace">
        <header className="workspace-header">
          <button
            className="icon-button mobile-menu-button"
            aria-label="Buka navigasi"
            ref={menuTriggerRef}
            onClick={() => setMenuOpen(true)}
          >
            <Menu aria-hidden="true" size={21} />
          </button>
          <div className="header-search">
            <Search aria-hidden="true" size={17} />
            <span>Cari manual atau produk EA</span>
            <kbd>⌘ K</kbd>
          </div>
          <div className="header-actions">
            <span className="environment-pill"><span /> Demo internal</span>
            <button
              className="icon-button notification-button"
              aria-expanded={notificationsOpen}
              aria-label="Notifikasi"
              onClick={() => setNotificationsOpen((open) => !open)}
            >
              <Bell aria-hidden="true" size={19} />
              <span className="notification-dot" />
            </button>
            {notificationsOpen && (
              <div className="notification-popover" role="status">
                <BookCheck aria-hidden="true" size={18} />
                <div><strong>1 manual perlu perhatian</strong><span>VMax EA memiliki 2 catatan validasi.</span></div>
              </div>
            )}
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
