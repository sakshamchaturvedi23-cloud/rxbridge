"use client";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Building2,
  ClipboardCheck,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Radio,
  Settings,
  ShieldCheck,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type {
  PharmacistMemberProfile,
  PharmacistMemberRole,
  PharmacyShopSummary,
} from "@/types/pharmacist";
import { NotificationBell } from "./NotificationBell";
import { VerificationBanner } from "./VerificationBanner";

interface PharmacistPortalContextValue {
  shop: PharmacyShopSummary;
  memberRole: PharmacistMemberRole;
  members: PharmacistMemberProfile[];
  canManageShop: boolean;
  currentUser: { id: string; email: string | null };
  unreadNotifications: number;
  setUnreadNotifications: React.Dispatch<React.SetStateAction<number>>;
  refreshProfile: () => Promise<void>;
}

const PharmacistPortalContext = createContext<PharmacistPortalContextValue | null>(
  null
);

export function usePharmacistPortal(): PharmacistPortalContextValue {
  const ctx = useContext(PharmacistPortalContext);
  if (!ctx) {
    throw new Error("usePharmacistPortal must be used inside PharmacistShell");
  }
  return ctx;
}

const NAV_ITEMS = [
  { href: "/pharmacist/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/pharmacist/inventory", label: "Inventory", icon: Package },
  { href: "/pharmacist/demand", label: "Patient Demand", icon: Radio },
  {
    href: "/pharmacist/prescriptions",
    label: "Prescription Verification",
    icon: ClipboardCheck,
  },
  {
    href: "/pharmacist/reservations",
    label: "Reservations / Orders",
    icon: Activity,
  },
  { href: "/pharmacist/profile", label: "Pharmacy Profile", icon: Building2 },
  { href: "/pharmacist/settings", label: "Settings", icon: Settings },
] as const;

const ROLE_LABELS: Record<PharmacistMemberRole, string> = {
  owner: "Owner",
  licensed_pharmacist: "Licensed Pharmacist",
  staff: "Staff",
};

const PUBLIC_PHARMACIST_PATHS = new Set([
  "/pharmacist/login",
  "/pharmacist/register",
]);

export function PharmacistShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isPublicAuthRoute = PUBLIC_PHARMACIST_PATHS.has(pathname);

  const [loading, setLoading] = useState(!isPublicAuthRoute);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [shop, setShop] = useState<PharmacyShopSummary | null>(null);
  const [memberRole, setMemberRole] = useState<PharmacistMemberRole>("staff");
  const [members, setMembers] = useState<PharmacistMemberProfile[]>([]);
  const [canManageShop, setCanManageShop] = useState(false);
  const [currentUser, setCurrentUser] = useState<{
    id: string;
    email: string | null;
  }>({ id: "", email: null });
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  const applyProfilePayload = useCallback(
    async (res: Response) => {
      const payload = await res.json().catch(() => ({}));

      if (res.status === 401) {
        router.replace("/pharmacist/login");
        return;
      }

      if (!res.ok) {
        setError(payload.error || "Unable to load pharmacist workspace");
        setErrorCode(payload.code || null);
        setLoading(false);
        return;
      }

      setShop(payload.shop);
      setMemberRole(payload.memberRole);
      setMembers(payload.members ?? []);
      setCanManageShop(Boolean(payload.canManageShop));
      setCurrentUser(payload.currentUser ?? { id: "", email: null });

      fetch("/api/pharmacist/dashboard", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((dash) => {
          if (dash && typeof dash.unreadNotifications === "number") {
            setUnreadNotifications(dash.unreadNotifications);
          }
        })
        .catch(() => {});

      setLoading(false);
    },
    [router]
  );

  const loadProfile = useCallback(async () => {
    if (isPublicAuthRoute) return;
    setLoading(true);
    setError(null);
    setErrorCode(null);

    try {
      const res = await fetch("/api/pharmacist/profile", {
        cache: "no-store",
      });
      await applyProfilePayload(res);
    } catch {
      setError("Network error while loading pharmacy workspace.");
      setLoading(false);
    }
  }, [applyProfilePayload, isPublicAuthRoute]);

  useEffect(() => {
    if (isPublicAuthRoute) return;
    let active = true;

    fetch("/api/pharmacist/profile", { cache: "no-store" })
      .then((res) => {
        if (active) return applyProfilePayload(res);
      })
      .catch(() => {
        if (active) {
          setError("Network error while loading pharmacy workspace.");
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [applyProfilePayload, isPublicAuthRoute]);

  async function handleSignOut() {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } finally {
      router.replace("/pharmacist/login");
    }
  }

  if (isPublicAuthRoute) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
          <p className="text-sm text-slate-400">Loading pharmacy workspace…</p>
        </div>
      </div>
    );
  }

  if (error || !shop) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-slate-100">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl">
          <h1 className="text-lg font-semibold text-white">
            Pharmacy Workspace Unavailable
          </h1>
          <p className="mt-2 text-sm text-slate-300">
            {error || "Your account is not currently linked to an active pharmacy."}
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            {errorCode === "NO_ACTIVE_MEMBERSHIP" ? (
              <Link
                href="/pharmacist/register"
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-400"
              >
                Register a Pharmacy
              </Link>
            ) : (
              <button
                type="button"
                onClick={loadProfile}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-400"
              >
                Retry
              </button>
            )}
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <PharmacistPortalContext.Provider
      value={{
        shop,
        memberRole,
        members,
        canManageShop,
        currentUser,
        unreadNotifications,
        setUnreadNotifications,
        refreshProfile: loadProfile,
      }}
    >
      <div className="flex min-h-screen bg-slate-950 text-slate-100">
        {/* Desktop Sidebar */}
        <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-800/80 bg-slate-900/70 lg:flex">
          <div className="flex h-16 items-center gap-2.5 border-b border-slate-800/80 px-5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-white">
                RxBridge Pharmacy
              </p>
              <p className="truncate text-xs text-slate-400">{shop.name}</p>
            </div>
          </div>

          <nav className="flex-1 space-y-1 p-3" aria-label="Pharmacist navigation">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive =
                pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    isActive
                      ? "bg-emerald-500/15 text-emerald-300"
                      : "text-slate-300 hover:bg-slate-800/70 hover:text-white"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-slate-800/80 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="rounded-md border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-200">
                {ROLE_LABELS[memberRole]}
              </span>
              <span
                className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                  shop.verification_status === "verified"
                    ? "bg-emerald-500/15 text-emerald-300"
                    : shop.verification_status === "pending"
                      ? "bg-amber-500/15 text-amber-300"
                      : "bg-rose-500/15 text-rose-300"
                }`}
              >
                {shop.verification_status}
              </span>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700/80 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-slate-800 hover:text-white"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </button>
          </div>
        </aside>

        {/* Main Content Area */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top Header */}
          <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-800/80 bg-slate-950/90 px-4 backdrop-blur sm:px-6">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setMobileNavOpen((prev) => !prev)}
                className="rounded-lg border border-slate-800 p-2 text-slate-300 hover:bg-slate-900 lg:hidden"
                aria-label="Toggle navigation"
              >
                {mobileNavOpen ? (
                  <X className="h-5 w-5" />
                ) : (
                  <Menu className="h-5 w-5" />
                )}
              </button>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">
                  {shop.name}
                </p>
                <p className="hidden truncate text-xs text-slate-400 sm:block">
                  {shop.address}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="hidden rounded-md border border-slate-800 bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-300 sm:inline-block">
                {ROLE_LABELS[memberRole]}
              </span>
              <NotificationBell
                unreadCount={unreadNotifications}
                onUnreadCountChange={setUnreadNotifications}
              />
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-lg border border-slate-800 bg-slate-900 p-2 text-slate-300 transition hover:bg-slate-800 lg:hidden"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </header>

          {/* Mobile / Tablet Navigation Drawer */}
          {mobileNavOpen && (
            <nav
              className="border-b border-slate-800 bg-slate-900 px-4 py-3 lg:hidden"
              aria-label="Mobile pharmacist navigation"
            >
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileNavOpen(false)}
                      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium ${
                        isActive
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "text-slate-300 hover:bg-slate-800"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </div>
            </nav>
          )}

          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-7xl">
              <VerificationBanner
                status={shop.verification_status}
                verificationNote={shop.verification_note}
              />
              {children}
            </div>
          </main>
        </div>
      </div>
    </PharmacistPortalContext.Provider>
  );
}
