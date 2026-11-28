"use client";

import React, { useEffect, useState } from "react";
import { History, X } from "lucide-react";
import type { InventoryItemDTO, InventoryMovementDTO } from "@/types/pharmacist";

interface InventoryMovementsDrawerProps {
  item: InventoryItemDTO;
  onClose: () => void;
}

export function InventoryMovementsDrawer({
  item,
  onClose,
}: InventoryMovementsDrawerProps) {
  const [movements, setMovements] = useState<InventoryMovementDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/pharmacist/inventory/${item.id}/movements`, {
      cache: "no-store",
    })
      .then(async (res) => {
        const payload = await res.json().catch(() => ({}));
        if (!active) return;
        if (!res.ok) {
          setError(payload.error || "Failed to load movement history");
          setLoading(false);
          return;
        }
        setMovements(payload.movements ?? []);
        setLoading(false);
      })
      .catch(() => {
        if (active) {
          setError("Network error loading movement ledger.");
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [item.id]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex justify-end bg-black/70"
    >
      <div className="flex h-full w-full max-w-lg flex-col border-l border-slate-800 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <History className="h-5 w-5 text-emerald-400" />
            <div>
              <h2 className="text-sm font-semibold text-white">
                Stock Movement Ledger
              </h2>
              <p className="text-xs text-slate-400">{item.display_name}</p>
            </div>
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

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-xl border border-slate-800 bg-slate-950/60"
                />
              ))}
            </div>
          ) : error ? (
            <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
              {error}
            </div>
          ) : movements.length === 0 ? (
            <p className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-xs text-slate-400">
              No movement ledger records found for this item yet.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {movements.map((mv) => (
                <li
                  key={mv.id}
                  className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded bg-slate-800 px-2 py-0.5 font-medium capitalize text-slate-200">
                      {mv.movement_type.replace(/_/g, " ")}
                    </span>
                    <span
                      className={`font-mono font-semibold ${
                        mv.delta_qty > 0
                          ? "text-emerald-400"
                          : mv.delta_qty < 0
                            ? "text-rose-400"
                            : "text-slate-400"
                      }`}
                    >
                      {mv.delta_qty > 0 ? `+${mv.delta_qty}` : mv.delta_qty}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-slate-300">
                    <span>
                      Qty: <strong>{mv.previous_qty}</strong> →{" "}
                      <strong>{mv.new_qty}</strong>
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {new Date(mv.created_at).toLocaleString()}
                    </span>
                  </div>
                  {mv.reason && (
                    <p className="mt-1.5 text-[11px] text-slate-400">
                      {mv.reason}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
