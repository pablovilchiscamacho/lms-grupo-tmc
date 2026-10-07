"use client";
import { useTransition } from "react";
import { CheckCheck } from "lucide-react";
import { markNotificationsRead } from "../actions";

export function MarkAllRead() {
  const [pending, start] = useTransition();
  return <button className="btn-secondary" disabled={pending} onClick={() => start(() => markNotificationsRead())}><CheckCheck className="size-4" /> Marcar todo como leído</button>;
}
