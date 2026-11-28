"use client";

import React, { useState } from "react";
import { X } from "lucide-react";
import type { DemandAvailabilityStatus, DemandFeedItemDTO } from "@/types/pharmacist";

interface DemandResponseModalProps {
  item: DemandFeedItemDTO;
  initialStatus: DemandAvailabilityStatus;
  onClose: () => void;
  onSubmitted: () => Promise<void> | void;
}

export function DemandResponseModal({
  item,
  initialStatus,
  onClose,
  onSubmitted,
}: DemandResponseModalProps) {
  const defaultQty =
    initialStatus === "unavailable"
      ? 0
      : item.my_response?.available_qty ??
        (initialStatus === "available"
          ? item.requested_qty
          : Math.max(1, Math.min(item.requested_qty, item.stock_match.availableQty || 1)));

  const [availabilityStatus, setAvailabilityStatus] =
    useState<DemandAvailabilityStatus>(initialStatus);
  const [availableQty, setAvailableQty] = useState(String(defaultQty));
  const [quotedUnitPrice, setQuotedUnitPrice] = useState(
    item.my_response?.quoted_unit_price !== null &&
      item.my_response?.quoted_unit_price !== undefined
      ? String(item.my_response.quoted_unit_price)
      : item.stock_match.unitPrice !== null
        ? String(item.stock_match.unitPrice)
        : ""
  );
  const [note, setNote] = useState(item.my_response?.note ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleStatusChange(next: DemandAvailabilityStatus) {
    setAvailabilityStatus(next);
    if (next === "unavailable") {
      setAvailableQty("0");
    } else if (Number(availableQty) <= 0) {
      setAvailableQty(
        String(
          next === "available"
            ? item.requested_qty
            : Math.max(1, item.stock_match.availableQty || 1)
        )
      );
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsedQty = Number.parseInt(availableQty, 10);
    const parsedPrice =
      quotedUnitPrice.trim() === "" ? null : Number(quotedUnitPrice);

    if (
      (availabilityStatus === "available" || availabilityStatus === "partial") &&
      (!Number.isInteger(parsedQty) || parsedQty <= 0)
    ) {
      setError("Available quantity must be a whole number > 0.");
      return;
    }
    if (availabilityStatus === "unavailable" && parsedQty !== 0) {
      setError("Available quantity must be 0 when marking unavailable.");
      return;
    }
    if (parsedPrice !== null && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) {
      setError("Quoted unit price must be >= 0.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/pharmacist/demand/${item.id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          availability_status: availabilityStatus,
          available_qty: availabilityStatus === "unavailable" ? 0 : parsedQty,
          quoted_unit_price: parsedPrice,
          note: note.trim() || null,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error || "Failed to submit availability response.");
        setSubmitting(false);
        return;
      }
      await onSubmitted();
      onClose();
    } catch {
      setError("Network error submitting demand response.");
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-base font-semibold text-white">
              Respond to Patient Demand
            </h2>
            <p className="text-xs text-slate-400">
              {item.medicine_name} • Requested qty: {item.requested_qty}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { value: "available", label: "Available" },
                { value: "partial", label: "Partial Qty" },
                { value: "unavailable", label: "Unavailable" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleStatusChange(opt.value)}
                className={`rounded-lg border px-2.5 py-2 text-xs font-medium transition ${
                  availabilityStatus === opt.value
                    ? "border-emerald-500/60 bg-emerald-500/20 text-emerald-200"
                    : "border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-800"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-slate-300">
                Available Qty
              </label>
              <input
                type="number"
                min={availabilityStatus === "unavailable" ? 0 : 1}
                disabled={availabilityStatus === "unavailable"}
                value={availableQty}
                onChange={(e) => setAvailableQty(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-60"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-300">
                Quoted Price / Unit (₹)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                disabled={availabilityStatus === "unavailable"}
                value={quotedUnitPrice}
                onChange={(e) => setQuotedUnitPrice(e.target.value)}
                placeholder="Optional"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-60"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs text-slate-300">
              Pharmacy Note (optional)
            </label>
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g., Ready at counter, valid prescription required for Schedule H"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
            />
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-800 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
            >
              {submitting ? "Submitting…" : "Send Response"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
