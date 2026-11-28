"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardCheck, RefreshCw, Search } from "lucide-react";
import type { PrescriptionVerificationStatus } from "@/types/pharmacist";

interface QueueRow {
  id: string;
  prescription_id: string;
  reservation_id: string | null;
  status: PrescriptionVerificationStatus;
  decision_reason: string | null;
  created_at: string;
  itemCount: number;
  hasNti: boolean;
  hasScheduleH: boolean;
  amberConfidenceCount: number;
  medicine_preview: string[];
}

const STATUS_TABS: Array<{
  value: "all" | PrescriptionVerificationStatus;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "pending_review", label: "Pending Review" },
  { value: "needs_clarification", label: "Needs Clarification" },
  { value: "partially_verified", label: "Partially Verified" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];

const BADGE_CLASS: Record<PrescriptionVerificationStatus, string> = {
  pending_review: "bg-amber-500/15 text-amber-300",
  needs_clarification: "bg-orange-500/15 text-orange-300",
  partially_verified: "bg-sky-500/15 text-sky-300",
  approved: "bg-emerald-500/15 text-emerald-300",
  rejected: "bg-rose-500/15 text-rose-300",
};

export default function PharmacistPrescriptionsQueuePage() {
  const [items, setItems] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<
    "all" | PrescriptionVerificationStatus
  >("all");
  const [search, setSearch] = useState("");

  const applyResponse = useCallback(async (res: Response) => {
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(payload.error || "Failed to load prescription queue.");
      setLoading(false);
      return;
    }
    setItems(payload.items ?? []);
    setLoading(false);
  }, []);

  const refreshQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      p.set("status", statusFilter);
      if (search.trim()) p.set("search", search.trim());
      const res = await fetch(`/api/pharmacist/prescriptions?${p.toString()}`, {
        cache: "no-store",
      });
      await applyResponse(res);
    } catch {
      setError("Network error loading prescription queue.");
      setLoading(false);
    }
  }, [applyResponse, search, statusFilter]);

  useEffect(() => {
    let active = true;
    const p = new URLSearchParams();
    p.set("status", statusFilter);
    if (search.trim()) p.set("search", search.trim());
    const timer = setTimeout(() => {
      fetch(`/api/pharmacist/prescriptions?${p.toString()}`, {
        cache: "no-store",
      })
        .then((res) => {
          if (active) return applyResponse(res);
        })
        .catch(() => {
          if (active) {
            setError("Network error loading prescription queue.");
            setLoading(false);
          }
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [applyResponse, search, statusFilter]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">
            Prescription Verification Queue
          </h1>
          <p className="text-sm text-slate-400">
            Review patient prescriptions assigned to your pharmacy, inspect NTI &
            Schedule H alerts, and record licensed pharmacist sign-off.
          </p>
        </div>
        <button
          type="button"
          onClick={refreshQueue}
          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-800 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh Queue
        </button>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/60 p-4">
        <div className="flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setStatusFilter(tab.value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                statusFilter === tab.value
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "border border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-800"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by prescription ID, reservation ID, or medicine…"
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
            onClick={refreshQueue}
            className="rounded border border-rose-400/40 px-2.5 py-1 hover:bg-rose-500/20"
          >
            Retry
          </button>
        </div>
      )}

      {loading && items.length === 0 ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center">
          <ClipboardCheck className="mx-auto h-7 w-7 text-slate-500" />
          <p className="mt-2 text-sm font-medium text-slate-200">
            No prescription verifications in this queue.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Prescriptions linked to incoming reservations will appear here for
            licensed pharmacist verification.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((row) => (
            <div
              key={row.id}
              className="flex flex-col gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/70 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-white">
                    Rx #{row.prescription_id.slice(0, 8)}
                  </span>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[11px] font-medium capitalize ${
                      BADGE_CLASS[row.status]
                    }`}
                  >
                    {row.status.replace(/_/g, " ")}
                  </span>
                  {row.hasNti && (
                    <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-rose-200">
                      Contains NTI
                    </span>
                  )}
                  {row.hasScheduleH && (
                    <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-200">
                      Schedule H
                    </span>
                  )}
                  {row.amberConfidenceCount > 0 && (
                    <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] text-amber-200">
                      {row.amberConfidenceCount} Amber OCR
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-300">
                  {row.itemCount} item(s):{" "}
                  {row.medicine_preview.join(", ") || "Pending extraction"}
                </p>
                <p className="text-[11px] text-slate-500">
                  Submitted: {new Date(row.created_at).toLocaleString()}
                  {row.reservation_id
                    ? ` • Reservation #${row.reservation_id.slice(0, 8)}`
                    : ""}
                </p>
              </div>

              <Link
                href={`/pharmacist/prescriptions/${row.prescription_id}`}
                className="self-start rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 sm:self-center"
              >
                Open Review →
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
