"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Lock, MapPin, Radio, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { DemandResponseModal } from "@/components/pharmacist/DemandResponseModal";
import { usePharmacistPortal } from "@/components/pharmacist/PharmacistShell";
import type { DemandAvailabilityStatus, DemandFeedItemDTO } from "@/types/pharmacist";

export default function PharmacistDemandPage() {
  const { shop } = usePharmacistPortal();
  const isVerified = shop.verification_status === "verified";

  const [items, setItems] = useState<DemandFeedItemDTO[]>([]);
  const [loading, setLoading] = useState(isVerified);
  const [error, setError] = useState<string | null>(null);

  const [medicine, setMedicine] = useState("");
  const [salt, setSalt] = useState("");
  const [strength, setStrength] = useState("");
  const [dosageForm, setDosageForm] = useState("");
  const [location, setLocation] = useState("");
  const [status, setStatus] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [responding, setResponding] = useState<{
    item: DemandFeedItemDTO;
    initialStatus: DemandAvailabilityStatus;
  } | null>(null);

  const buildQuery = useCallback(() => {
    const p = new URLSearchParams();
    if (medicine.trim()) p.set("medicine", medicine.trim());
    if (salt.trim()) p.set("salt", salt.trim());
    if (strength.trim()) p.set("strength", strength.trim());
    if (dosageForm.trim()) p.set("dosageForm", dosageForm.trim());
    if (location.trim()) p.set("location", location.trim());
    p.set("status", status);
    if (dateFrom) p.set("from", dateFrom);
    if (dateTo) p.set("to", dateTo);
    return p.toString();
  }, [dateFrom, dateTo, dosageForm, location, medicine, salt, status, strength]);

  const applyDemandResponse = useCallback(async (res: Response) => {
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(payload.error || "Failed to load patient demand feed.");
      setLoading(false);
      return;
    }
    setItems(payload.items ?? []);
    setLoading(false);
  }, []);

  const refreshDemand = useCallback(async () => {
    if (!isVerified) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pharmacist/demand?${buildQuery()}`, {
        cache: "no-store",
      });
      await applyDemandResponse(res);
    } catch {
      setError("Network error while loading demand feed.");
      setLoading(false);
    }
  }, [applyDemandResponse, buildQuery, isVerified]);

  useEffect(() => {
    if (!isVerified) return;
    let active = true;
    const timer = setTimeout(() => {
      fetch(`/api/pharmacist/demand?${buildQuery()}`, {
        cache: "no-store",
      })
        .then((res) => {
          if (active) return applyDemandResponse(res);
        })
        .catch(() => {
          if (active) {
            setError("Network error while loading demand feed.");
            setLoading(false);
          }
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [applyDemandResponse, buildQuery, isVerified]);

  if (!isVerified) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-8 text-center">
        <Lock className="mx-auto h-8 w-8 text-amber-400" />
        <h1 className="mt-3 text-lg font-semibold text-white">
          Patient Demand Feed Locked Until Verified
        </h1>
        <p className="mx-auto mt-2 max-w-lg text-xs text-slate-400">
          Your pharmacy is currently{" "}
          <strong className="text-amber-300">{shop.verification_status}</strong>.
          Only verified pharmacies can inspect anonymized local medicine requests and
          submit availability quotes.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">
            Patient Medicine Demand
          </h1>
          <p className="text-sm text-slate-400">
            Anonymized patient medicine requests within{" "}
            {shop.service_radius_km ?? 5} km of {shop.name}.
          </p>
        </div>
        <button
          type="button"
          onClick={refreshDemand}
          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-800 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh Feed
        </button>
      </div>

      <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3.5 py-2.5 text-xs text-emerald-200">
        <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
        <span>
          Privacy-protected feed: patient identities, contact details, and unrelated
          medical histories are stripped server-side.
        </span>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/60 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={medicine}
            onChange={(e) => setMedicine(e.target.value)}
            placeholder="Medicine name…"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-xs text-white"
          />
        </div>
        <input
          type="text"
          value={salt}
          onChange={(e) => setSalt(e.target.value)}
          placeholder="Active salt / composition…"
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
        />
        <input
          type="text"
          value={strength}
          onChange={(e) => setStrength(e.target.value)}
          placeholder="Strength (e.g. 500mg)"
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
        />
        <input
          type="text"
          value={dosageForm}
          onChange={(e) => setDosageForm(e.target.value)}
          placeholder="Dosage form (tablet, syrup…)"
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
        />
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Service area / locality…"
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200"
        >
          <option value="all">All Statuses</option>
          <option value="open">Open</option>
          <option value="responded">Responded</option>
          <option value="partially_available">Partially Available</option>
          <option value="unavailable">Unavailable</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          aria-label="Date from"
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          aria-label="Date to"
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200"
        />
      </div>

      {error && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={refreshDemand}
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
              className="h-24 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/60"
            />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-8 text-center">
          <Radio className="mx-auto h-7 w-7 text-slate-500" />
          <p className="mt-2 text-sm font-medium text-slate-200">
            No matching patient medicine requests right now.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Adjust filters or check back when nearby patients broadcast medicine
            availability requests.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const matchBadge = item.stock_match.canFulfilFull
              ? {
                  label: `Full Stock Available (${item.stock_match.availableQty} ATP)`,
                  cls: "bg-emerald-500/15 text-emerald-300",
                }
              : item.stock_match.inStock
                ? {
                    label: `Partial Stock (${item.stock_match.availableQty} ATP)`,
                    cls: "bg-amber-500/15 text-amber-300",
                  }
                : {
                    label: "Out of Stock in Inventory",
                    cls: "bg-rose-500/15 text-rose-300",
                  };

            return (
              <article
                key={item.id}
                className="flex flex-col gap-4 rounded-2xl border border-slate-800/80 bg-slate-900/70 p-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-white">
                      {item.medicine_name}
                    </h2>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${matchBadge.cls}`}
                    >
                      {matchBadge.label}
                    </span>
                    <span className="rounded-md border border-slate-700 bg-slate-800 px-2 py-0.5 text-[11px] capitalize text-slate-300">
                      {item.status.replace(/_/g, " ")}
                    </span>
                  </div>

                  <p className="text-xs text-slate-300">
                    {item.active_ingredients || "Salt unspecified"}
                    {item.strength ? ` • ${item.strength}` : ""}
                    {item.dosage_form ? ` • ${item.dosage_form}` : ""}
                    {" • "}
                    <strong>Qty Requested: {item.requested_qty}</strong>
                  </p>

                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {item.service_area || "Local area"}
                      {item.distance_km !== null ? ` (${item.distance_km} km)` : ""}
                    </span>
                    <span>
                      Requested: {new Date(item.created_at).toLocaleString()}
                    </span>
                  </div>

                  {item.my_response && (
                    <p className="text-xs text-emerald-300">
                      Your response:{" "}
                      <strong className="capitalize">
                        {item.my_response.availability_status}
                      </strong>{" "}
                      ({item.my_response.available_qty} qty
                      {item.my_response.quoted_unit_price !== null
                        ? ` @ ₹${item.my_response.quoted_unit_price}`
                        : ""}
                      )
                      {item.my_response.note ? ` — "${item.my_response.note}"` : ""}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setResponding({ item, initialStatus: "available" })
                    }
                    className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
                  >
                    Mark Available
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setResponding({ item, initialStatus: "partial" })
                    }
                    className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-200 hover:bg-amber-500/20"
                  >
                    Partial Qty
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setResponding({ item, initialStatus: "unavailable" })
                    }
                    className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
                  >
                    Mark Unavailable
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {responding && (
        <DemandResponseModal
          key={`${responding.item.id}-${responding.initialStatus}`}
          item={responding.item}
          initialStatus={responding.initialStatus}
          onClose={() => setResponding(null)}
          onSubmitted={refreshDemand}
        />
      )}
    </div>
  );
}
