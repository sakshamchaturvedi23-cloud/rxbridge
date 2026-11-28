"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Activity, RefreshCw, Search } from "lucide-react";
import { usePharmacistPortal } from "@/components/pharmacist/PharmacistShell";
import {
  ReservationDetailDrawer,
  type ReservationDetailRecord,
} from "@/components/pharmacist/ReservationDetailDrawer";
import { FULFILMENT_STATUSES, type FulfilmentStatus } from "@/types/pharmacist";

const STATUS_BADGE: Record<FulfilmentStatus, string> = {
  pending: "bg-amber-500/15 text-amber-300",
  under_review: "bg-sky-500/15 text-sky-300",
  awaiting_clarification: "bg-orange-500/15 text-orange-300",
  approved: "bg-emerald-500/15 text-emerald-300",
  partially_approved: "bg-emerald-500/15 text-emerald-200",
  preparing: "bg-indigo-500/15 text-indigo-300",
  ready_for_pickup: "bg-teal-500/15 text-teal-200",
  fulfilled: "bg-teal-600/25 text-teal-200",
  rejected: "bg-rose-500/15 text-rose-300",
  cancelled: "bg-slate-700/60 text-slate-300",
  expired: "bg-rose-600/20 text-rose-200",
};

export default function PharmacistReservationsPage() {
  const { shop } = usePharmacistPortal();
  const isVerifiedShop = shop.verification_status === "verified";

  const [reservations, setReservations] = useState<ReservationDetailRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | FulfilmentStatus>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const applyResponse = useCallback(async (res: Response) => {
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(payload.error || "Failed to load reservations.");
      setLoading(false);
      return;
    }
    setReservations(payload.reservations ?? []);
    setLoading(false);
  }, []);

  const refreshReservations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      p.set("status", statusFilter);
      if (search.trim()) p.set("search", search.trim());
      const res = await fetch(`/api/pharmacist/reservations?${p.toString()}`, {
        cache: "no-store",
      });
      await applyResponse(res);
    } catch {
      setError("Network error loading reservations.");
      setLoading(false);
    }
  }, [applyResponse, search, statusFilter]);

  useEffect(() => {
    let active = true;
    const p = new URLSearchParams();
    p.set("status", statusFilter);
    if (search.trim()) p.set("search", search.trim());
    const timer = setTimeout(() => {
      fetch(`/api/pharmacist/reservations?${p.toString()}`, {
        cache: "no-store",
      })
        .then((res) => {
          if (active) return applyResponse(res);
        })
        .catch(() => {
          if (active) {
            setError("Network error loading reservations.");
            setLoading(false);
          }
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [applyResponse, search, statusFilter]);

  const selectedReservation =
    reservations.find((r) => r.id === selectedId) ?? null;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">
            Reservations &amp; Fulfilment
          </h1>
          <p className="text-sm text-slate-400">
            Manage incoming reservations, enforce Schedule H prescription gates, and
            handle pickup fulfilment with atomic stock locks.
          </p>
        </div>
        <button
          type="button"
          onClick={refreshReservations}
          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-800 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/60 p-4">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${
              statusFilter === "all"
                ? "bg-emerald-500/20 text-emerald-300"
                : "border border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-800"
            }`}
          >
            All
          </button>
          {FULFILMENT_STATUSES.map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium capitalize ${
                statusFilter === st
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "border border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-800"
              }`}
            >
              {st.replace(/_/g, " ")}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by reservation ID, patient ref, or medicine…"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-xs text-white"
          />
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={refreshReservations}
            className="rounded border border-rose-400/40 px-2.5 py-1 hover:bg-rose-500/20"
          >
            Retry
          </button>
        </div>
      )}

      {loading && reservations.length === 0 ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60"
            />
          ))}
        </div>
      ) : reservations.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center">
          <Activity className="mx-auto h-7 w-7 text-slate-500" />
          <p className="mt-2 text-sm font-medium text-slate-200">
            No reservations match this filter.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {reservations.map((r) => (
            <div
              key={r.id}
              className="flex flex-col gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/70 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-white">
                    #{r.id.slice(0, 8)}
                  </span>
                  <span className="text-xs text-slate-300">
                    {r.patient_display_label}
                  </span>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ${
                      STATUS_BADGE[r.fulfilment_status]
                    }`}
                  >
                    {r.fulfilment_status.replace(/_/g, " ")}
                  </span>
                  {r.prescription_id && (
                    <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] capitalize text-slate-200">
                      Rx:{" "}
                      {(
                        r.prescription_verification?.status ?? "pending_review"
                      ).replace(/_/g, " ")}
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-300">
                  {r.items.length} item(s):{" "}
                  {r.items
                    .map(
                      (it) => `${it.requested_brand_name} (×${it.requested_qty})`
                    )
                    .join(", ")}
                </p>

                <p className="text-[11px] text-slate-500">
                  Est. ₹{r.estimated_total} •{" "}
                  {r.created_at
                    ? new Date(r.created_at).toLocaleString()
                    : "—"}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSelectedId(r.id)}
                className="self-start rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 sm:self-center"
              >
                Manage Order →
              </button>
            </div>
          ))}
        </div>
      )}

      {selectedReservation && (
        <ReservationDetailDrawer
          key={`${selectedReservation.id}-${selectedReservation.fulfilment_status}`}
          reservation={selectedReservation}
          isVerifiedShop={isVerifiedShop}
          onClose={() => setSelectedId(null)}
          onTransitioned={refreshReservations}
        />
      )}
    </div>
  );
}
