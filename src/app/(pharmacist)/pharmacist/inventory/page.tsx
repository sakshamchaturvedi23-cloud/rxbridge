"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Archive,
  Edit3,
  History,
  Minus,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { InventoryFormModal } from "@/components/pharmacist/InventoryFormModal";
import { InventoryMovementsDrawer } from "@/components/pharmacist/InventoryMovementsDrawer";
import type { InventoryItemDTO, InventoryStatus } from "@/types/pharmacist";

const STATUS_TABS: Array<{ value: "all" | InventoryStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "in_stock", label: "In Stock" },
  { value: "low_stock", label: "Low Stock" },
  { value: "out_of_stock", label: "Out of Stock" },
  { value: "unavailable", label: "Unavailable" },
  { value: "expired", label: "Expired" },
];

const STATUS_BADGE: Record<InventoryStatus, string> = {
  in_stock: "bg-emerald-500/15 text-emerald-300",
  low_stock: "bg-amber-500/15 text-amber-300",
  out_of_stock: "bg-rose-500/15 text-rose-300",
  unavailable: "bg-slate-700/60 text-slate-300",
  expired: "bg-rose-600/25 text-rose-200",
};

export default function PharmacistInventoryPage() {
  const [items, setItems] = useState<InventoryItemDTO[]>([]);
  const [summary, setSummary] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | InventoryStatus>("all");
  const [catalogLink, setCatalogLink] = useState<"all" | "linked" | "unlinked">("all");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  const [modalState, setModalState] = useState<
    | { open: false }
    | { open: true; mode: "create"; item: null }
    | { open: true; mode: "edit"; item: InventoryItemDTO }
  >({ open: false });
  const [movementsItem, setMovementsItem] = useState<InventoryItemDTO | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<InventoryItemDTO | null>(null);
  const [archiving, setArchiving] = useState(false);

  const buildQueryString = useCallback(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    params.set("status", statusFilter);
    params.set("catalogLink", catalogLink);
    params.set("page", String(page));
    params.set("pageSize", "20");
    return params.toString();
  }, [catalogLink, page, search, statusFilter]);

  const applyListResponse = useCallback(async (res: Response) => {
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(payload.error || "Failed to load inventory.");
      setLoading(false);
      return;
    }
    setItems(payload.items ?? []);
    setSummary(payload.summary ?? {});
    setTotalPages(payload.pagination?.totalPages ?? 1);
    setLoading(false);
  }, []);

  const refreshInventory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pharmacist/inventory?${buildQueryString()}`, {
        cache: "no-store",
      });
      await applyListResponse(res);
    } catch {
      setError("Network error while loading inventory.");
      setLoading(false);
    }
  }, [applyListResponse, buildQueryString]);

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      fetch(`/api/pharmacist/inventory?${buildQueryString()}`, {
        cache: "no-store",
      })
        .then((res) => {
          if (active) return applyListResponse(res);
        })
        .catch(() => {
          if (active) {
            setError("Network error while loading inventory.");
            setLoading(false);
          }
        });
    }, 150);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [applyListResponse, buildQueryString]);

  async function handleQuickDelta(item: InventoryItemDTO, delta: number) {
    setActionError(null);
    try {
      const res = await fetch(`/api/pharmacist/inventory/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          delta,
          movement_type: delta > 0 ? "restock" : "manual_adjustment",
          reason: delta > 0 ? "Quick +1 restock" : "Quick -1 adjustment",
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(payload.error || "Stock adjustment rejected.");
        return;
      }
      await refreshInventory();
    } catch {
      setActionError("Network error adjusting stock.");
    }
  }

  async function handleToggleAvailability(item: InventoryItemDTO) {
    setActionError(null);
    try {
      const res = await fetch(`/api/pharmacist/inventory/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_available: !item.is_available }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(payload.error || "Failed to toggle availability.");
        return;
      }
      await refreshInventory();
    } catch {
      setActionError("Network error toggling availability.");
    }
  }

  async function handleConfirmArchive() {
    if (!archiveTarget) return;
    setArchiving(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/pharmacist/inventory/${archiveTarget.id}`, {
        method: "DELETE",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionError(payload.error || "Failed to archive item.");
        setArchiving(false);
        setArchiveTarget(null);
        return;
      }
      setArchiving(false);
      setArchiveTarget(null);
      await refreshInventory();
    } catch {
      setActionError("Network error archiving item.");
      setArchiving(false);
      setArchiveTarget(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">
            Inventory Management
          </h1>
          <p className="text-sm text-slate-400">
            Track catalog-linked and manual stock, batch expiry, reserved holds, and
            movement history.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refreshInventory}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() =>
              setModalState({ open: true, mode: "create", item: null })
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
          >
            <Plus className="h-4 w-4" />
            Add Medicine
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/60 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {STATUS_TABS.map((tab) => {
            const count =
              tab.value === "all" ? summary.total : summary[tab.value];
            const active = statusFilter === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => {
                  setStatusFilter(tab.value);
                  setPage(1);
                }}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  active
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "border border-slate-800 bg-slate-950 text-slate-300 hover:bg-slate-800"
                }`}
              >
                {tab.label}
                {typeof count === "number" ? ` (${count})` : ""}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search brand, generic salt, batch, or manufacturer…"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>
          <select
            value={catalogLink}
            onChange={(e) => {
              setCatalogLink(e.target.value as "all" | "linked" | "unlinked");
              setPage(1);
            }}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200"
          >
            <option value="all">All Sources</option>
            <option value="linked">Catalog-Linked Only</option>
            <option value="unlinked">Manual / Unlinked Only</option>
          </select>
        </div>
      </div>

      {(error || actionError) && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200"
        >
          <span>{error || actionError}</span>
          {error && (
            <button
              type="button"
              onClick={refreshInventory}
              className="rounded border border-rose-400/40 px-2.5 py-1 hover:bg-rose-500/20"
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-900/60">
        {loading && items.length === 0 ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-lg bg-slate-800/50"
              />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm font-medium text-slate-200">
              No inventory items match these filters.
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Add a catalog-linked medicine or manual pharmacy entry to get started.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                  <th className="px-4 py-3 font-medium">Medicine & Source</th>
                  <th className="px-4 py-3 font-medium">Batch / Expiry</th>
                  <th className="px-4 py-3 font-medium">Price</th>
                  <th className="px-4 py-3 font-medium">ATP / Reserved</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/30">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-white">
                        {item.display_name}
                      </p>
                      <p className="mt-0.5 text-slate-400">
                        {item.composition_display || item.generic_name || "—"}
                        {item.pack_size ? ` • ${item.pack_size}` : ""}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            item.is_catalog_linked
                              ? "bg-emerald-500/15 text-emerald-300"
                              : "bg-amber-500/15 text-amber-200"
                          }`}
                        >
                          {item.is_catalog_linked
                            ? "Catalog-Linked"
                            : "Manual / Unlinked"}
                        </span>
                        {item.is_nti && (
                          <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] text-rose-300">
                            NTI
                          </span>
                        )}
                        {item.is_rx_required && (
                          <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300">
                            Rx
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-300">
                      <p className="font-mono">{item.batch_number || "—"}</p>
                      <p
                        className={`mt-0.5 ${
                          item.is_expired ? "text-rose-400" : "text-slate-400"
                        }`}
                      >
                        {item.expiry_date || "No expiry"}
                      </p>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-200">
                      <p>
                        ₹
                        {item.selling_price ??
                          item.mrp ??
                          "—"}
                      </p>
                      {item.mrp !== null &&
                        item.selling_price !== null &&
                        item.selling_price < item.mrp && (
                          <p className="text-[11px] text-slate-500 line-through">
                            MRP ₹{item.mrp}
                          </p>
                        )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleQuickDelta(item, -1)}
                          disabled={
                            item.quantity_on_hand <= item.quantity_reserved
                          }
                          className="rounded border border-slate-700 p-1 text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                          title="Decrease stock by 1"
                        >
                          <Minus className="h-3 w-3" />
                        </button>
                        <span className="min-w-8 text-center font-mono text-sm font-semibold text-white">
                          {item.available_to_promise}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleQuickDelta(item, 1)}
                          className="rounded border border-slate-700 p-1 text-slate-300 hover:bg-slate-800"
                          title="Increase stock by 1"
                        >
                          <Plus className="h-3 w-3" />
                        </button>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-400">
                        On hand: {item.quantity_on_hand} • Held:{" "}
                        {item.quantity_reserved}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-md px-2 py-0.5 font-medium capitalize ${
                          STATUS_BADGE[item.status]
                        }`}
                      >
                        {item.status.replace(/_/g, " ")}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleToggleAvailability(item)}
                        className="mt-1.5 block text-[11px] text-slate-400 underline hover:text-slate-200"
                      >
                        {item.is_available ? "Pause listing" : "Mark available"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setMovementsItem(item)}
                          className="rounded-lg border border-slate-700 p-1.5 text-slate-300 hover:bg-slate-800"
                          title="Movement ledger"
                        >
                          <History className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setModalState({ open: true, mode: "edit", item })
                          }
                          className="rounded-lg border border-slate-700 p-1.5 text-slate-300 hover:bg-slate-800"
                          title="Edit item"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setArchiveTarget(item)}
                          className="rounded-lg border border-slate-700 p-1.5 text-rose-300 hover:bg-rose-500/15"
                          title="Archive item"
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span>
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-lg border border-slate-800 px-3 py-1.5 hover:bg-slate-800 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-lg border border-slate-800 px-3 py-1.5 hover:bg-slate-800 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {modalState.open && (
        <InventoryFormModal
          key={modalState.item?.id ?? "create-new"}
          mode={modalState.mode}
          initialItem={modalState.item}
          onClose={() => setModalState({ open: false })}
          onSaved={refreshInventory}
        />
      )}

      {movementsItem && (
        <InventoryMovementsDrawer
          key={movementsItem.id}
          item={movementsItem}
          onClose={() => setMovementsItem(null)}
        />
      )}

      {archiveTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-4"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <h2 className="text-base font-semibold text-white">
              Archive Inventory Item?
            </h2>
            <p className="mt-2 text-xs text-slate-300">
              Archiving <strong>{archiveTarget.display_name}</strong> hides it from
              patient discovery and new reservations while preserving all historical
              movements and past order links.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                disabled={archiving}
                onClick={() => setArchiveTarget(null)}
                className="rounded-lg border border-slate-700 px-3.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={archiving}
                onClick={handleConfirmArchive}
                className="rounded-lg bg-rose-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-rose-400 disabled:opacity-60"
              >
                {archiving ? "Archiving…" : "Archive Item"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
