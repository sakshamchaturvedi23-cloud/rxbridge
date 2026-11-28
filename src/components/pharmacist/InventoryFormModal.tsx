"use client";

import React, { useEffect, useState } from "react";
import { AlertTriangle, Search, X } from "lucide-react";
import type { MedicineSearchItem } from "@/lib/clinical/medicine-search";
import { isInventoryExpired } from "@/lib/pharmacist/inventory-service";
import type { InventoryItemDTO } from "@/types/pharmacist";

interface InventoryFormModalProps {
  mode: "create" | "edit";
  initialItem?: InventoryItemDTO | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export function InventoryFormModal({
  mode,
  initialItem,
  onClose,
  onSaved,
}: InventoryFormModalProps) {
  const isEdit = mode === "edit" && Boolean(initialItem);

  const [isCatalogLinked, setIsCatalogLinked] = useState<boolean>(
    initialItem ? initialItem.is_catalog_linked : true
  );

  // Catalog search state
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogResults, setCatalogResults] = useState<MedicineSearchItem[]>([]);
  const [searchingCatalog, setSearchingCatalog] = useState(false);
  const [selectedMedicine, setSelectedMedicine] =
    useState<MedicineSearchItem | null>(
      initialItem?.is_catalog_linked && initialItem.medicine_id
        ? {
            id: initialItem.medicine_id,
            brand_name: initialItem.display_name,
            manufacturer: initialItem.manufacturer,
            pack_size: initialItem.pack_size,
            composition_display: initialItem.composition_display ?? "",
            composition_key: initialItem.composition_key ?? "",
            mrp: initialItem.mrp ?? 0,
            is_jan_aushadhi: initialItem.is_jan_aushadhi,
            is_nti: initialItem.is_nti,
            is_schedule_h: initialItem.is_schedule_h,
          }
        : null
    );

  // Manual / unlinked fields
  const [customBrandName, setCustomBrandName] = useState(
    initialItem && !initialItem.is_catalog_linked
      ? initialItem.display_name
      : ""
  );
  const [customGenericName, setCustomGenericName] = useState(
    initialItem?.generic_name ?? ""
  );
  const [customComposition, setCustomComposition] = useState(
    initialItem && !initialItem.is_catalog_linked
      ? initialItem.composition_display ?? ""
      : ""
  );
  const [customStrength, setCustomStrength] = useState(
    initialItem?.strength ?? ""
  );
  const [customDosageForm, setCustomDosageForm] = useState(
    initialItem?.dosage_form ?? "oral_solid"
  );
  const [customPackSize, setCustomPackSize] = useState(
    initialItem && !initialItem.is_catalog_linked
      ? initialItem.pack_size ?? ""
      : ""
  );
  const [customManufacturer, setCustomManufacturer] = useState(
    initialItem && !initialItem.is_catalog_linked
      ? initialItem.manufacturer ?? ""
      : ""
  );
  const [isRxRequired, setIsRxRequired] = useState(
    initialItem?.is_rx_required ?? false
  );

  // Shared stock, batch & pricing fields
  const [mrp, setMrp] = useState(
    initialItem?.mrp !== null && initialItem?.mrp !== undefined
      ? String(initialItem.mrp)
      : ""
  );
  const [sellingPrice, setSellingPrice] = useState(
    initialItem?.selling_price !== null &&
      initialItem?.selling_price !== undefined
      ? String(initialItem.selling_price)
      : ""
  );
  const [quantityOnHand, setQuantityOnHand] = useState(
    String(initialItem?.quantity_on_hand ?? 0)
  );
  const [minStockThreshold, setMinStockThreshold] = useState(
    String(initialItem?.min_stock_threshold ?? 5)
  );
  const [batchNumber, setBatchNumber] = useState(
    initialItem?.batch_number ?? ""
  );
  const [expiryDate, setExpiryDate] = useState(initialItem?.expiry_date ?? "");
  const [isAvailable, setIsAvailable] = useState(
    initialItem?.is_available ?? true
  );
  const [adjustmentReason, setAdjustmentReason] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mountTimestamp] = useState(() => Date.now());

  useEffect(() => {
    const trimmed = catalogQuery.trim();
    if (isEdit || !isCatalogLinked || trimmed.length < 2) {
      return;
    }

    let active = true;
    const timer = setTimeout(() => {
      setSearchingCatalog(true);
      fetch(`/api/medicines/search?q=${encodeURIComponent(trimmed)}&limit=12`)
        .then((res) => (res.ok ? res.json() : { medicines: [] }))
        .then((data) => {
          if (active) {
            setCatalogResults(data.medicines ?? []);
            setSearchingCatalog(false);
          }
        })
        .catch(() => {
          if (active) {
            setCatalogResults([]);
            setSearchingCatalog(false);
          }
        });
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [catalogQuery, isCatalogLinked, isEdit]);

  const expiredWarning = isInventoryExpired(expiryDate);
  const nearExpiryWarning =
    !expiredWarning &&
    Boolean(expiryDate) &&
    (() => {
      const expMs = new Date(`${expiryDate}T00:00:00Z`).getTime();
      const diffDays = (expMs - mountTimestamp) / (1000 * 60 * 60 * 24);
      return diffDays > 0 && diffDays <= 30;
    })();

  function handleSelectCatalogMedicine(med: MedicineSearchItem) {
    setSelectedMedicine(med);
    setCatalogResults([]);
    setCatalogQuery(med.brand_name);
    if (!mrp) setMrp(String(med.mrp));
    if (!sellingPrice) setSellingPrice(String(med.mrp));
    setIsRxRequired(Boolean(med.is_schedule_h || med.is_nti));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsedQty = Number.parseInt(quantityOnHand, 10);
    const parsedThreshold = Number.parseInt(minStockThreshold, 10);
    const parsedMrp = mrp.trim() === "" ? null : Number(mrp);
    const parsedSelling =
      sellingPrice.trim() === "" ? null : Number(sellingPrice);

    if (!Number.isInteger(parsedQty) || parsedQty < 0) {
      setError("Available quantity must be a whole number >= 0.");
      return;
    }
    if (!Number.isInteger(parsedThreshold) || parsedThreshold < 0) {
      setError("Minimum stock threshold must be a whole number >= 0.");
      return;
    }
    if (parsedMrp !== null && (!Number.isFinite(parsedMrp) || parsedMrp < 0)) {
      setError("MRP must be >= 0.");
      return;
    }
    if (
      parsedSelling !== null &&
      (!Number.isFinite(parsedSelling) || parsedSelling < 0)
    ) {
      setError("Selling price must be >= 0.");
      return;
    }
    if (isAvailable && expiredWarning) {
      setError("Expired batches cannot be marked as available.");
      return;
    }

    if (isEdit && initialItem) {
      if (parsedQty < initialItem.quantity_reserved) {
        setError(
          `Quantity on hand (${parsedQty}) cannot be less than reserved stock (${initialItem.quantity_reserved}).`
        );
        return;
      }

      const patchPayload: Record<string, unknown> = {
        mrp: parsedMrp,
        selling_price: parsedSelling,
        min_stock_threshold: parsedThreshold,
        batch_number: batchNumber.trim() || null,
        expiry_date: expiryDate.trim() || null,
        is_available: isAvailable,
        is_rx_required: isRxRequired,
      };

      if (parsedQty !== initialItem.quantity_on_hand) {
        patchPayload.quantity_on_hand = parsedQty;
        if (adjustmentReason.trim()) {
          patchPayload.reason = adjustmentReason.trim();
        }
      }

      if (!initialItem.is_catalog_linked) {
        patchPayload.custom_brand_name = customBrandName.trim() || null;
        patchPayload.custom_generic_name = customGenericName.trim() || null;
        patchPayload.custom_composition = customComposition.trim() || null;
        patchPayload.custom_strength = customStrength.trim() || null;
        patchPayload.custom_dosage_form = customDosageForm.trim() || null;
        patchPayload.custom_pack_size = customPackSize.trim() || null;
        patchPayload.custom_manufacturer = customManufacturer.trim() || null;
      }

      setSubmitting(true);
      try {
        const res = await fetch(`/api/pharmacist/inventory/${initialItem.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patchPayload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || "Failed to update inventory item.");
          setSubmitting(false);
          return;
        }
        await onSaved();
        onClose();
      } catch {
        setError("Network error while updating inventory.");
        setSubmitting(false);
      }
      return;
    }

    // Create mode
    if (isCatalogLinked && !selectedMedicine) {
      setError("Select a medicine from the RxBridge catalog or switch to Manual / Unlinked entry.");
      return;
    }
    if (!isCatalogLinked && !customBrandName.trim() && !customGenericName.trim()) {
      setError("Enter a Brand Name or Generic Name for a manual/unlinked item.");
      return;
    }

    const createPayload: Record<string, unknown> = {
      is_catalog_linked: isCatalogLinked,
      medicine_id: isCatalogLinked ? selectedMedicine?.id : null,
      mrp: parsedMrp,
      selling_price: parsedSelling,
      quantity_on_hand: parsedQty,
      min_stock_threshold: parsedThreshold,
      batch_number: batchNumber.trim() || null,
      expiry_date: expiryDate.trim() || null,
      is_available: isAvailable,
      is_rx_required: isRxRequired,
    };

    if (!isCatalogLinked) {
      createPayload.custom_brand_name = customBrandName.trim() || null;
      createPayload.custom_generic_name = customGenericName.trim() || null;
      createPayload.custom_composition = customComposition.trim() || null;
      createPayload.custom_strength = customStrength.trim() || null;
      createPayload.custom_dosage_form = customDosageForm.trim() || null;
      createPayload.custom_pack_size = customPackSize.trim() || null;
      createPayload.custom_manufacturer = customManufacturer.trim() || null;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/pharmacist/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createPayload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Failed to add inventory item.");
        setSubmitting(false);
        return;
      }
      await onSaved();
      onClose();
    } catch {
      setError("Network error while adding inventory.");
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
    >
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
        <div className="mb-5 flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h2 className="text-lg font-semibold text-white">
              {isEdit ? "Edit Inventory Item" : "Add Inventory Item"}
            </h2>
            <p className="text-xs text-slate-400">
              {isCatalogLinked
                ? "Catalog-Linked medicine from curated RxBridge catalog"
                : "Manual / Unlinked pharmacy entry (never pollutes master catalog)"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {!isEdit && (
          <div className="mb-5 grid grid-cols-2 gap-2 rounded-xl border border-slate-800 bg-slate-950 p-1">
            <button
              type="button"
              onClick={() => setIsCatalogLinked(true)}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
                isCatalogLinked
                  ? "bg-emerald-500/20 text-emerald-300"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Catalog-Linked Medicine
            </button>
            <button
              type="button"
              onClick={() => setIsCatalogLinked(false)}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition ${
                !isCatalogLinked
                  ? "bg-amber-500/20 text-amber-200"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Manual / Unlinked Entry
            </button>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200"
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {isCatalogLinked ? (
            <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              {!isEdit && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-300">
                    Search Curated Medicine Catalog
                  </label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <input
                      type="text"
                      value={catalogQuery}
                      onChange={(e) => setCatalogQuery(e.target.value)}
                      placeholder="Type brand or salt (e.g., Augmentin, Metformin, Dolo)…"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  {searchingCatalog && (
                    <p className="mt-1.5 text-xs text-slate-400">
                      Searching catalog…
                    </p>
                  )}
                  {catalogResults.length > 0 && (
                    <ul className="mt-2 max-h-48 divide-y divide-slate-800 overflow-y-auto rounded-lg border border-slate-800 bg-slate-900">
                      {catalogResults.map((med) => (
                        <li key={med.id}>
                          <button
                            type="button"
                            onClick={() => handleSelectCatalogMedicine(med)}
                            className="flex w-full items-start justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-slate-800"
                          >
                            <div>
                              <p className="font-medium text-white">
                                {med.brand_name}
                              </p>
                              <p className="text-slate-400">
                                {med.composition_display}
                                {med.pack_size ? ` • ${med.pack_size}` : ""}
                              </p>
                            </div>
                            <span className="shrink-0 font-mono text-emerald-300">
                              ₹{med.mrp}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {selectedMedicine && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-white">
                      {selectedMedicine.brand_name}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-300">
                        Catalog-Linked
                      </span>
                      {selectedMedicine.is_jan_aushadhi && (
                        <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-sky-300">
                          Jan Aushadhi
                        </span>
                      )}
                      {selectedMedicine.is_nti && (
                        <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-rose-300">
                          NTI
                        </span>
                      )}
                      {selectedMedicine.is_schedule_h && (
                        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-amber-200">
                          Schedule H
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="mt-1 text-slate-300">
                    {selectedMedicine.composition_display}
                    {selectedMedicine.pack_size
                      ? ` • ${selectedMedicine.pack_size}`
                      : ""}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 rounded-xl border border-amber-500/30 bg-slate-950/60 p-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs text-slate-300">
                  Brand Name
                </label>
                <input
                  type="text"
                  value={customBrandName}
                  onChange={(e) => setCustomBrandName(e.target.value)}
                  placeholder="e.g., Local Cefixime 200"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-300">
                  Generic Name
                </label>
                <input
                  type="text"
                  value={customGenericName}
                  onChange={(e) => setCustomGenericName(e.target.value)}
                  placeholder="e.g., Cefixime"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs text-slate-300">
                  Composition / Active Salts
                </label>
                <input
                  type="text"
                  value={customComposition}
                  onChange={(e) => setCustomComposition(e.target.value)}
                  placeholder="e.g., Cefixime 200mg"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-300">
                  Strength
                </label>
                <input
                  type="text"
                  value={customStrength}
                  onChange={(e) => setCustomStrength(e.target.value)}
                  placeholder="e.g., 200mg"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-300">
                  Dosage Form
                </label>
                <select
                  value={customDosageForm}
                  onChange={(e) => setCustomDosageForm(e.target.value)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                >
                  <option value="oral_solid">Oral Solid (Tablet/Capsule)</option>
                  <option value="oral_liquid">Oral Liquid (Syrup/Drops)</option>
                  <option value="topical">Topical (Cream/Gel/Ointment)</option>
                  <option value="injectable">Injectable</option>
                  <option value="inhaler">Inhaler / Respule</option>
                  <option value="ophthalmic_otic">Eye / Ear / Nasal</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-300">
                  Pack Size
                </label>
                <input
                  type="text"
                  value={customPackSize}
                  onChange={(e) => setCustomPackSize(e.target.value)}
                  placeholder="e.g., strip of 10 tablets"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-300">
                  Manufacturer
                </label>
                <input
                  type="text"
                  value={customManufacturer}
                  onChange={(e) => setCustomManufacturer(e.target.value)}
                  placeholder="Optional manufacturer"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>
            </div>
          )}

          {/* Pricing, Stock & Batch */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-slate-300">MRP (₹)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={mrp}
                onChange={(e) => setMrp(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-300">
                Selling Price (₹)
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={sellingPrice}
                onChange={(e) => setSellingPrice(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-slate-300">
                Batch Number
              </label>
              <input
                type="text"
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.target.value)}
                placeholder="e.g., B26-091"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-300">
                Quantity On Hand
              </label>
              <input
                type="number"
                min={initialItem?.quantity_reserved ?? 0}
                step="1"
                required
                value={quantityOnHand}
                onChange={(e) => setQuantityOnHand(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
              {initialItem && initialItem.quantity_reserved > 0 && (
                <p className="mt-1 text-[11px] text-amber-300">
                  Min {initialItem.quantity_reserved} (currently reserved)
                </p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-300">
                Low-Stock Threshold
              </label>
              <input
                type="number"
                min="0"
                step="1"
                required
                value={minStockThreshold}
                onChange={(e) => setMinStockThreshold(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs text-slate-300">
                Expiry Date
              </label>
              <input
                type="date"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
              />
            </div>
          </div>

          {isEdit &&
            initialItem &&
            Number(quantityOnHand) !== initialItem.quantity_on_hand && (
              <div>
                <label className="mb-1 block text-xs text-slate-300">
                  Stock Adjustment Reason (Audit Ledger)
                </label>
                <input
                  type="text"
                  value={adjustmentReason}
                  onChange={(e) => setAdjustmentReason(e.target.value)}
                  placeholder="e.g., New distributor invoice #4021 / damaged strip"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>
            )}

          {(expiredWarning || nearExpiryWarning) && (
            <div
              className={`flex items-center gap-2 rounded-xl border p-3 text-xs ${
                expiredWarning
                  ? "border-rose-500/40 bg-rose-500/10 text-rose-200"
                  : "border-amber-500/40 bg-amber-500/10 text-amber-200"
              }`}
            >
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                {expiredWarning
                  ? "This batch is expired (expiry date <= today). Uncheck Available for Sale or update to a valid future batch."
                  : "Heads up: this batch expires within the next 30 days."}
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-6 pt-1 text-xs text-slate-300">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={isAvailable}
                onChange={(e) => setIsAvailable(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950"
              />
              Available for patient discovery & reservations
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={isRxRequired}
                onChange={(e) => setIsRxRequired(e.target.checked)}
                className="rounded border-slate-700 bg-slate-950"
              />
              Prescription Required (Schedule H / Rx)
            </label>
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-800 pt-4">
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
              className="rounded-lg bg-emerald-500 px-5 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
            >
              {submitting
                ? "Saving…"
                : isEdit
                  ? "Save Inventory Changes"
                  : "Add to Inventory"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
