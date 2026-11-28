"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, X } from "lucide-react";
import type { PharmacistNotificationDTO } from "@/types/pharmacist";

interface NotificationBellProps {
  unreadCount: number;
  onUnreadCountChange: (count: number) => void;
}

function resolveNotificationRoute(n: PharmacistNotificationDTO): string {
  switch (n.entity_type) {
    case "prescription":
      return n.entity_id
        ? `/pharmacist/prescriptions/${n.entity_id}`
        : "/pharmacist/prescriptions";
    case "reservation":
      return "/pharmacist/reservations";
    case "inventory":
      return "/pharmacist/inventory";
    case "demand":
      return "/pharmacist/demand";
    default:
      return "/pharmacist/dashboard";
  }
}

export function NotificationBell({
  unreadCount,
  onUnreadCountChange,
}: NotificationBellProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [notifications, setNotifications] = useState<PharmacistNotificationDTO[]>([]);
  const [loading, setLoading] = useState(false);

  const loadNotifications = useCallback(
    async (selectedFilter: "all" | "unread") => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/pharmacist/notifications?filter=${selectedFilter}`,
          { cache: "no-store" }
        );
        const payload = await res.json().catch(() => ({}));
        if (res.ok) {
          setNotifications(payload.notifications ?? []);
          if (typeof payload.unreadCount === "number") {
            onUnreadCountChange(payload.unreadCount);
          }
        }
      } finally {
        setLoading(false);
      }
    },
    [onUnreadCountChange]
  );

  useEffect(() => {
    if (!open) return;
    let active = true;
    fetch(`/api/pharmacist/notifications?filter=${filter}`, {
      cache: "no-store",
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => {
        if (!active || !payload) return;
        setNotifications(payload.notifications ?? []);
        if (typeof payload.unreadCount === "number") {
          onUnreadCountChange(payload.unreadCount);
        }
        setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filter, onUnreadCountChange, open]);

  async function handleMarkRead(id: string) {
    const res = await fetch("/api/pharmacist/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const payload = await res.json().catch(() => ({}));
    if (res.ok) {
      if (typeof payload.unreadCount === "number") {
        onUnreadCountChange(payload.unreadCount);
      }
      await loadNotifications(filter);
    }
  }

  async function handleMarkAllRead() {
    const res = await fetch("/api/pharmacist/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markAllRead: true }),
    });
    const payload = await res.json().catch(() => ({}));
    if (res.ok) {
      onUnreadCountChange(payload.unreadCount ?? 0);
      await loadNotifications(filter);
    }
  }

  async function handleOpenNotification(n: PharmacistNotificationDTO) {
    if (!n.is_read) {
      await handleMarkRead(n.id);
    }
    setOpen(false);
    router.push(resolveNotificationRoute(n));
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="relative inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4 text-slate-300" />
        <span className="hidden sm:inline">Alerts</span>
        {unreadCount > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-semibold text-slate-950">
            {unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Pharmacist notifications"
          className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl sm:w-96"
        >
          <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
            <span className="text-xs font-semibold text-white">
              Notifications ({unreadCount} unread)
            </span>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-400 hover:text-emerald-300"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark all read
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Close notifications"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="flex gap-2 border-b border-slate-800/80 px-4 py-2 text-[11px]">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`rounded px-2 py-1 font-medium ${
                filter === "all"
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setFilter("unread")}
              className={`rounded px-2 py-1 font-medium ${
                filter === "unread"
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Unread
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="p-4 text-center text-xs text-slate-400">
                Loading notifications…
              </div>
            ) : notifications.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                {filter === "unread"
                  ? "All caught up — no unread alerts."
                  : "No notifications yet."}
              </div>
            ) : (
              <ul className="divide-y divide-slate-800/70">
                {notifications.map((n) => (
                  <li
                    key={n.id}
                    className={`px-4 py-3 text-xs transition hover:bg-slate-800/50 ${
                      n.is_read ? "opacity-70" : "bg-emerald-500/5"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleOpenNotification(n)}
                      className="w-full text-left"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-white">{n.title}</p>
                        {!n.is_read && (
                          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-300">
                        {n.body}
                      </p>
                      <p className="mt-1 text-[10px] text-slate-500">
                        {new Date(n.created_at).toLocaleString()}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
