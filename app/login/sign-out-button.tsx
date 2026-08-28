"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";
import { signOutAction } from "./actions";

export function SignOutButton({ className = "secondary-button" }: { className?: string }) {
  const [pending, start] = useTransition();
  return (
    <button className={className} disabled={pending} onClick={() => start(() => signOutAction())}>
      <LogOut aria-hidden="true" size={16} /> {pending ? "Keluar…" : "Keluar"}
    </button>
  );
}
