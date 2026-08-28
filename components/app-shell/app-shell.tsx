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
import { useEffect, useState } from "react";

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
      { href: "/templates", label: "Template", icon: BookOpenText },
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
      { href: "/resources/compliance", label: "Checklist Kepatuhan", icon: ClipboardCheck },
    ],
  },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <aside className="sidebar" aria-label="Navigasi utama">
      <div className="brand-lockup">
        <span className="brand-mark" aria-hidden="true">S</span>
        <span>
          <strong>SMARTIN</strong>
          <small>Manual Builder</small>
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
        <div className="sidebar-user">
          <span className="avatar">AS</span>
          <span>
            <strong>Andi Setiawan</strong>
            <small>Developer</small>
          </span>
          <ChevronDown aria-hidden="true" size={16} />
        </div>
      </div>
    </aside>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setMenuOpen(false);
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  return (
    <div className="app-frame">
      <a className="skip-link" href="#main-content">Lewati ke konten utama</a>
      <div className="desktop-sidebar"><Sidebar /></div>
      {menuOpen && (
        <div className="drawer-layer" role="presentation">
          <button className="drawer-scrim" aria-label="Tutup navigasi" onClick={() => setMenuOpen(false)} />
          <div className="mobile-sidebar">
            <button className="icon-button drawer-close" aria-label="Tutup navigasi" onClick={() => setMenuOpen(false)}>
              <X aria-hidden="true" size={20} />
            </button>
            <Sidebar onNavigate={() => setMenuOpen(false)} />
          </div>
        </div>
      )}
      <div className="workspace">
        <header className="workspace-header">
          <button className="icon-button mobile-menu-button" aria-label="Buka navigasi" onClick={() => setMenuOpen(true)}>
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
