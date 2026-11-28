"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  Package,
  PackageCheck,
  PackageX,
  Radio,
  RefreshCw,
  ShoppingBag,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { usePharmacistPortal } from "@/components/pharmacist/PharmacistShell";
import type { PharmacistDashboardResponse } from "@/types/pharmacist";

export default function PharmacistDashboardPage() {
  const { shop, setUnreadNotifications } = usePharmacistPortal();
  const [data, setData] = useState<PharmacistDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applyDashboardResponse = useCallback(
    async (res: Response) => {
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || "Failed to load dashboard metrics");
        setLoading(false);
        return;
      }
      setData(payload as PharmacistDashboardResponse);
      setUnreadNotifications(payload.unreadNotifications ?? 0);
      setLoading(false);
    },
    [setUnreadNotifications]
  );

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/pharmacist/dashboard", {
        cache: "no-store",
      });
      await applyDashboardResponse(res);
    } catch {
      setError("Network error loading dashboard KPIs.");
      setLoading(false);
    }
  }, [applyDashboardResponse]);

  useEffect(() => {
    let active = true;
    fetch("/api/pharmacist/dashboard", { cache: "no-store" })
      .then((res) => {
        if (active) return applyDashboardResponse(res);
      })
      .catch(() => {
        if (active) {
          setError("Network error loading dashboard KPIs.");
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [applyDashboardResponse]);

  const kpis = data?.kpis;

  const kpiCards = [
    {
      label: "Total Medicines Listed",
      value: kpis?.totalMedicinesListed ?? 0,
      icon: Package,
      accent: "text-sky-400 bg-sky-500/10 border-sky-500/20",
      href: "/pharmacist/inventory",
    },
    {
      label: "Total Available Items",
      value: kpis?.totalAvailableItems ?? 0,
      icon: PackageCheck,
      accent: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
      href: "/pharmacist/inventory",
    },
    {
      label: "Low Stock Medicines",
      value: kpis?.lowStockMedicines ?? 0,
      icon: TriangleAlert,
      accent: "text-amber-400 bg-amber-500/10 border-amber-500/20",
      href: "/pharmacist/inventory",
    },
    {
      label: "Out of Stock Medicines",
      value: kpis?.outOfStockMedicines ?? 0,
      icon: PackageX,
      accent: "text-rose-400 bg-rose-500/10 border-rose-500/20",
      href: "/pharmacist/inventory",
    },
    {
      label: "Incoming Patient Requests",
      value: kpis?.incomingPatientRequests ?? 0,
      icon: Radio,
      accent: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
      href: "/pharmacist/demand",
    },
    {
      label: "Pending Rx Verifications",
      value: kpis?.pendingPrescriptionVerifications ?? 0,
      icon: ClipboardCheck,
      accent: "text-amber-300 bg-amber-500/10 border-amber-500/20",
      href: "/pharmacist/prescriptions",
    },
    {
      label: "Approved Reservations",
      value: kpis?.approvedReservations ?? 0,
      icon: ShoppingBag,
      accent: "text-emerald-300 bg-emerald-500/10 border-emerald-500/20",
      href: "/pharmacist/reservations",
    },
    {
      label: "Rejected Requests",
      value: kpis?.rejectedRequests ?? 0,
      icon: XCircle,
      accent: "text-rose-300 bg-rose-500/10 border-rose-500/20",
      href: "/pharmacist/reservations",
    },
    {
      label: "Completed Fulfilments",
      value: kpis?.completedFulfilments ?? 0,
      icon: CheckCircle2,
      accent: "text-teal-300 bg-teal-500/10 border-teal-500/20",
      href: "/pharmacist/reservations",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">
            Pharmacy Overview
          </h1>
          <p className="text-sm text-slate-400">
            Real-time inventory, clinical review queue, and reservation metrics for{" "}
            <span className="text-slate-200">{shop.name}</span>.
          </p>
        </div>
        <button
          type="button"
          onClick={loadDashboard}
          disabled={loading}
          className="inline-flex items-center gap-2 self-start rounded-lg border border-slate-800 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 transition hover:bg-slate-800 disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh KPIs
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-200"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={loadDashboard}
            className="rounded-lg border border-rose-400/40 bg-rose-500/20 px-3 py-1 text-xs font-medium hover:bg-rose-500/30"
          >
            Retry
          </button>
        </div>
      )}

      {/* 9 Real DB KPI Cards */}
      <section aria-label="Overview KPIs">
        {loading && !data ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 9 }).map((_, idx) => (
              <div
                key={idx}
                className="h-28 animate-pulse rounded-xl border border-slate-800 bg-slate-900/60 p-4"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {kpiCards.map((card) => {
              const Icon = card.icon;
              return (
                <Link
                  key={card.label}
                  href={card.href}
                  className="group rounded-xl border border-slate-800/80 bg-slate-900/70 p-4 transition hover:border-slate-700 hover:bg-slate-900"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-400 group-hover:text-slate-300">
                      {card.label}
                    </span>
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-lg border ${card.accent}`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                  </div>
                  <p className="mt-3 text-3xl font-semibold tracking-tight text-white">
                    {card.value}
                  </p>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* Quick Actions & Low-Stock Alerts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-slate-800/80 bg-slate-900/70 p-5">
          <h2 className="text-sm font-semibold text-white">Quick Actions</h2>
          <p className="mt-1 text-xs text-slate-400">
            Jump directly to core pharmacy workflows.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <Link
              href="/pharmacist/inventory"
              className="rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-sm font-medium text-slate-200 transition hover:border-emerald-500/40 hover:text-emerald-300"
            >
              Manage Inventory →
            </Link>
            <Link
              href="/pharmacist/demand"
              className="rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-sm font-medium text-slate-200 transition hover:border-emerald-500/40 hover:text-emerald-300"
            >
              Patient Demand Feed →
            </Link>
            <Link
              href="/pharmacist/prescriptions"
              className="rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-sm font-medium text-slate-200 transition hover:border-emerald-500/40 hover:text-emerald-300"
            >
              Verify Prescriptions →
            </Link>
            <Link
              href="/pharmacist/reservations"
              className="rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2.5 text-sm font-medium text-slate-200 transition hover:border-emerald-500/40 hover:text-emerald-300"
            >
              Reservations & Pickups →
            </Link>
          </div>
        </section>

        <section className="rounded-xl border border-slate-800/80 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">
              Low-Stock & Expiry Alerts
            </h2>
            <Link
              href="/pharmacist/inventory"
              className="text-xs font-medium text-emerald-400 hover:text-emerald-300"
            >
              View Inventory
            </Link>
          </div>
          {!data || data.lowStockAlerts.length === 0 ? (
            <p className="mt-4 rounded-lg border border-slate-800 bg-slate-950/60 p-4 text-xs text-slate-400">
              No low-stock, out-of-stock, or expired alerts right now.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {data.lowStockAlerts.map((alert) => (
                <li
                  key={alert.id}
                  className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs"
                >
                  <span className="truncate font-medium text-slate-200">
                    {alert.displayName}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">
                      ATP: {alert.availableToPromise} (min {alert.minStockThreshold})
                    </span>
                    <span
                      className={`rounded px-2 py-0.5 font-medium ${
                        alert.status === "expired" || alert.status === "out_of_stock"
                          ? "bg-rose-500/15 text-rose-300"
                          : "bg-amber-500/15 text-amber-300"
                      }`}
                    >
                      {alert.status.replace("_", " ")}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
