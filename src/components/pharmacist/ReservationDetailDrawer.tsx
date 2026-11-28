"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Clock, X } from "lucide-react";
import { RESERVATION_TRANSITIONS } from "@/lib/pharmacist/state-machines";
import type {
  FulfilmentStatus,
  PrescriptionVerificationStatus,
} from "@/types/pharmacist";

export interface ReservationDetailLineItem {
  id: string;
  requested_medicine_id: string;
  requested_brand_name: string;
  requested_composition: string | null;
  is_nti: boolean;
  is_schedule_h: boolean;
  inventory_id: string | null;
  item_status: string;
  requested_qty: number;
  approved_qty: number;
  stock_reserved_qty: number;
  stock_deducted: boolean;
  live_available_to_promise: number;
  live_inventory_status: string;
  unit_price: number | null;
}

export interface ReservationDetailRecord {
  id: string;
  prescription_id: string | null;
  plan_mode: string;
  fulfilment_status: FulfilmentStatus;
  verification_status: string;
  status_reason: string | null;
  estimated_total: number;
  patient_display_label: string;
  created_at: string | null;
  items: ReservationDetailLineItem[];
  prescription_verification: {
    id: string;
    status: PrescriptionVerificationStatus;
    decision_reason: string | null;
  } | null;
  history: Array<{
    id: string;
    from_status: string | null;
    to_status: string;
    actor_role: string | null;
    reason: string | null;
    created_at: string;
  }>;
}

interface ReservationDetailDrawerProps {
  reservation: ReservationDetailRecord;
  isVerifiedShop: boolean;
  onClose: () => void;
  onTransitioned: () => Promise<void> | void;
}

export function ReservationDetailDrawer({
  reservation,
  isVerifiedShop,
  onClose,
  onTransitioned,
}: ReservationDetailDrawerProps) {
  const allowedNext = new Set(
    RESERVATION_TRANSITIONS[reservation.fulfilment_status] ?? []
  );

  const [approvedQtys, setApprovedQtys] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const it of reservation.items) {
      init[it.id] =
        it.approved_qty > 0
          ? it.approved_qty
          : Math.min(it.requested_qty, it.live_available_to_promise);
    }
    return init;
  });

  const [reasonPrompt, setReasonPrompt] = useState<{
    target: FulfilmentStatus;
    title: string;
  } | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEditApprovals =
    allowedNext.has("approved") || allowedNext.has("partially_approved");

  async function executeTransition(
    targetStatus: FulfilmentStatus,
    reason?: string
  ) {
    setSubmitting(true);
    setError(null);

    const payload: Record<string, unknown> = {
      target_status: targetStatus,
    };
    if (reason?.trim()) {
      payload.reason = reason.trim();
    }
    if (targetStatus === "partially_approved") {
      payload.item_approvals = reservation.items.map((it) => ({
        reservation_item_id: it.id,
        inventory_id: it.inventory_id,
        approved_qty: approvedQtys[it.id] ?? 0,
      }));
    } else if (targetStatus === "approved") {
      payload.item_approvals = reservation.items.map((it) => ({
        reservation_item_id: it.id,
        inventory_id: it.inventory_id,
        approved_qty: it.requested_qty,
      }));
    }

    try {
      const res = await fetch(
        `/api/pharmacist/reservations/${reservation.id}/transition`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Transition failed.");
        setSubmitting(false);
        return;
      }

      setReasonPrompt(null);
      setReasonText("");
      setSubmitting(false);
      await onTransitioned();
      onClose();
    } catch {
      setError("Network error executing reservation transition.");
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex justify-end bg-black/75"
    >
      <div className="flex h-full w-full max-w-2xl flex-col border-l border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-white">
              Reservation #{reservation.id.slice(0, 8)}
            </h2>
            <p className="text-xs text-slate-400">
              {reservation.patient_display_label} • Mode: {reservation.plan_mode} •
              Est. ₹{reservation.estimated_total}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Close drawer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Prescription Verification Status */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 text-xs">
            <div>
              <span className="text-slate-400">Fulfilment Status: </span>
              <strong className="capitalize text-white">
                {reservation.fulfilment_status.replace(/_/g, " ")}
              </strong>
            </div>
            {reservation.prescription_id ? (
              <div className="flex items-center gap-2">
                <span className="rounded bg-slate-800 px-2 py-0.5 capitalize text-slate-200">
                  Rx:{" "}
                  {(
                    reservation.prescription_verification?.status ??
                    "pending_review"
                  ).replace(/_/g, " ")}
                </span>
                <Link
                  href={`/pharmacist/prescriptions/${reservation.prescription_id}`}
                  className="font-medium text-emerald-400 underline hover:text-emerald-300"
                >
                  Open Rx Review →
                </Link>
              </div>
            ) : (
              <span className="text-slate-400">No prescription attached</span>
            )}
          </div>

          {/* Line Items */}
          <section className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Requested Medicines ({reservation.items.length})
            </h3>
            {reservation.items.map((it) => (
              <div
                key={it.id}
                className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 text-xs sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold text-white">
                      {it.requested_brand_name}
                    </span>
                    {it.is_nti && (
                      <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] text-rose-200">
                        NTI
                      </span>
                    )}
                    {it.is_schedule_h && (
                      <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] text-sky-200">
                        Schedule H
                      </span>
                    )}
                  </div>
                  <p className="text-slate-400">
                    {it.requested_composition || "—"}
                  </p>
                  <p className="text-slate-300">
                    Requested: <strong>{it.requested_qty}</strong> • Approved:{" "}
                    <strong>{it.approved_qty}</strong> • Reserved:{" "}
                    <strong>{it.stock_reserved_qty}</strong> • Live ATP:{" "}
                    <strong
                      className={
                        it.live_available_to_promise >= it.requested_qty
                          ? "text-emerald-300"
                          : "text-amber-300"
                      }
                    >
                      {it.live_available_to_promise}
                    </strong>
                    {it.stock_deducted && (
                      <span className="ml-2 inline-flex items-center gap-1 text-emerald-400">
                        <CheckCircle2 className="h-3 w-3" /> Deducted
                      </span>
                    )}
                  </p>
                </div>

                {canEditApprovals && (
                  <div className="shrink-0">
                    <label className="mb-1 block text-[11px] text-slate-400">
                      Partial Approve Qty
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={it.requested_qty}
                      value={approvedQtys[it.id] ?? 0}
                      onChange={(e) =>
                        setApprovedQtys((prev) => ({
                          ...prev,
                          [it.id]: Math.max(
                            0,
                            Math.min(
                              it.requested_qty,
                              Number.parseInt(e.target.value || "0", 10) || 0
                            )
                          ),
                        }))
                      }
                      className="w-24 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-white"
                    />
                  </div>
                )}
              </div>
            ))}
          </section>

          {/* Action Controls */}
          <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Fulfilment Actions
            </h3>
            {!isVerifiedShop ? (
              <p className="text-xs text-amber-300">
                Fulfilment transitions are disabled until pharmacy verification is
                approved.
              </p>
            ) : allowedNext.size === 0 ? (
              <p className="text-xs text-slate-400">
                This reservation is in a terminal state (
                {reservation.fulfilment_status}).
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {allowedNext.has("under_review") && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => executeTransition("under_review")}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700"
                  >
                    Start Review
                  </button>
                )}
                {allowedNext.has("approved") && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => executeTransition("approved")}
                    className="rounded-lg bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
                  >
                    Accept (Full)
                  </button>
                )}
                {allowedNext.has("partially_approved") && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => executeTransition("partially_approved")}
                    className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-medium text-emerald-200 hover:bg-emerald-500/25"
                  >
                    Partially Approve
                  </button>
                )}
                {allowedNext.has("preparing") && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => executeTransition("preparing")}
                    className="rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
                  >
                    Mark Preparing
                  </button>
                )}
                {allowedNext.has("ready_for_pickup") && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => executeTransition("ready_for_pickup")}
                    className="rounded-lg bg-indigo-500 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-400"
                  >
                    Mark Ready for Pickup
                  </button>
                )}
                {allowedNext.has("fulfilled") && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => executeTransition("fulfilled")}
                    className="rounded-lg bg-teal-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-teal-400"
                  >
                    Mark Fulfilled (Deduct Stock)
                  </button>
                )}
                {allowedNext.has("awaiting_clarification") && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() =>
                      setReasonPrompt({
                        target: "awaiting_clarification",
                        title: "Request Clarification",
                      })
                    }
                    className="rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-xs font-medium text-amber-200 hover:bg-amber-500/25"
                  >
                    Request Clarification
                  </button>
                )}
                {allowedNext.has("rejected") && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() =>
                      setReasonPrompt({
                        target: "rejected",
                        title: "Reject Reservation",
                      })
                    }
                    className="rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs font-medium text-rose-200 hover:bg-rose-500/25"
                  >
                    Reject
                  </button>
                )}
                {allowedNext.has("cancelled") && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() =>
                      setReasonPrompt({
                        target: "cancelled",
                        title: "Confirm Reservation Cancellation",
                      })
                    }
                    className="rounded-lg border border-rose-500/40 px-3 py-2 text-xs font-medium text-rose-300 hover:bg-rose-500/10"
                  >
                    Cancel Reservation
                  </button>
                )}
              </div>
            )}

            {reasonPrompt && (
              <div className="mt-3 space-y-2.5 rounded-xl border border-slate-700 bg-slate-900 p-3.5">
                <p className="text-xs font-semibold text-white">
                  {reasonPrompt.title}
                </p>
                <textarea
                  rows={2}
                  value={reasonText}
                  onChange={(e) => setReasonText(e.target.value)}
                  placeholder="Enter mandatory reason / note…"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setReasonPrompt(null);
                      setReasonText("");
                    }}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    disabled={submitting || !reasonText.trim()}
                    onClick={() =>
                      executeTransition(reasonPrompt.target, reasonText)
                    }
                    className="rounded-lg bg-rose-500 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-rose-400 disabled:opacity-50"
                  >
                    Confirm
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Status History */}
          <section className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Status Transition History
            </h3>
            {reservation.history.length === 0 ? (
              <p className="text-xs text-slate-500">No transition history yet.</p>
            ) : (
              <ul className="space-y-2">
                {reservation.history.map((h) => (
                  <li
                    key={h.id}
                    className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-white">
                        {h.from_status
                          ? `${h.from_status.replace(/_/g, " ")} → `
                          : ""}
                        {h.to_status.replace(/_/g, " ")}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                        <Clock className="h-3 w-3" />
                        {new Date(h.created_at).toLocaleString()}
                      </span>
                    </div>
                    {h.reason && (
                      <p className="mt-1 text-[11px] text-slate-300">{h.reason}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
