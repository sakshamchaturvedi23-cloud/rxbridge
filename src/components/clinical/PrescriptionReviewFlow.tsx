"use client";

/**
 * src/components/clinical/PrescriptionReviewFlow.tsx
 *
 * P2 Review & Confirmation Container Component:
 * 1. Unified Entry: Accepts extracted OCR prescription medicines OR direct type-ahead search additions.
 * 2. Enforces "Right Medicine First": Each row must be verified/confirmed before alternatives unlock.
 * 3. Fetches same-salt alternatives & Jan Aushadhi generic options upon confirmation.
 * 4. Auto-Learning Hook: Persists OCR corrections to `ocr_aliases` via `recordOcrAlias`.
 * 5. Gated Handoff: Gates "Continue to Pharmacy Plan" until all medicines are confirmed,
 *    outputting a clean `ConfirmedMedicine[]` payload for P3 `/api/plans`.
 *
 * Owner: P2 (AI Extraction, Clinical Rules & Data Owner)
 * Branch: p2-ai-data
 */

import React, { useState, useMemo } from "react";
import {
  Plus,
  Search,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  Info,
} from "lucide-react";
import type { ExtractedMedicineItem, ConfirmedMedicine } from "@/types/contracts";
import type { MedicineSearchItem } from "@/lib/clinical/medicine-search";
import { recordOcrAlias } from "@/lib/clinical/alias-learning";
import {
  MedicineReviewRow,
  type ReviewRowState,
} from "./MedicineReviewRow";

interface PrescriptionReviewFlowProps {
  initialItems?: ExtractedMedicineItem[];
  onContinueToPlan?: (confirmedMedicines: ConfirmedMedicine[]) => void;
  className?: string;
}

export function PrescriptionReviewFlow({
  initialItems = [],
  onContinueToPlan,
  className = "",
}: PrescriptionReviewFlowProps) {
  // Convert ExtractedMedicineItem[] into initial ReviewRowState[]
  const [rows, setRows] = useState<ReviewRowState[]>(() => {
    return initialItems.map((item, index) => {
      return {
        temp_id: item.temp_id || `rx_item_${index}`,
        source: "ocr",
        raw_text: item.raw_text,
        match_status: item.match_status || "needs_selection",
        dose: item.dose,
        duration: item.duration,
        suggestions: item.suggestions,

        matched_medicine_id: item.matched_medicine_id,
        brand_name: item.brand_name || item.raw_text,
        composition_display: item.composition_display,
        composition_key: item.composition_key,
        mrp: 0, // Will be fetched if matched
        is_jan_aushadhi: false,
        is_nti: item.is_nti,
        is_schedule_h: item.is_schedule_h,

        is_custom: false,
        isConfirmed: false, // Right Medicine First: user must verify

        alternativesLoading: false,
        alternativesGroup: null,
        selected_alternative_id: null,
      };
    });
  });

  // State for top "+ Add Medicine" type-ahead search
  const [isAddingMedicine, setIsAddingMedicine] = useState(false);
  const [typeaheadQuery, setTypeaheadQuery] = useState("");
  const [typeaheadResults, setTypeaheadResults] = useState<MedicineSearchItem[]>([]);
  const [isSearchingTypeahead, setIsSearchingTypeahead] = useState(false);

  // Auto-fetch alternatives helper for a confirmed medicine
  const fetchAlternativesForRow = async (
    rowId: string,
    medicineId: string
  ) => {
    setRows((prev) =>
      prev.map((r) =>
        r.temp_id === rowId ? { ...r, alternativesLoading: true } : r
      )
    );

    try {
      const res = await fetch(`/api/medicines/search?medicine_id=${medicineId}`);
      if (res.ok) {
        const data = await res.json();
        const baseMed: MedicineSearchItem = data.medicine;
        setRows((prev) =>
          prev.map((r) => {
            if (r.temp_id !== rowId) return r;
            return {
              ...r,
              brand_name: baseMed?.brand_name || r.brand_name,
              composition_display: baseMed?.composition_display || r.composition_display,
              composition_key: baseMed?.composition_key || r.composition_key,
              mrp: baseMed?.mrp || r.mrp,
              is_nti: baseMed?.is_nti ?? r.is_nti,
              is_schedule_h: baseMed?.is_schedule_h ?? r.is_schedule_h,
              alternativesGroup: data.groups,
              alternativesLoading: false,
            };
          })
        );
      } else {
        setRows((prev) =>
          prev.map((r) =>
            r.temp_id === rowId ? { ...r, alternativesLoading: false } : r
          )
        );
      }
    } catch (err) {
      console.warn("Failed to fetch alternatives for row:", err);
      setRows((prev) =>
        prev.map((r) =>
          r.temp_id === rowId ? { ...r, alternativesLoading: false } : r
        )
      );
    }
  };

  // Row Confirmation Action
  const handleConfirmRow = (confirmedRow: ReviewRowState) => {
    const updated = { ...confirmedRow, isConfirmed: true };

    setRows((prev) =>
      prev.map((r) => (r.temp_id === confirmedRow.temp_id ? updated : r))
    );

    // Auto-learning Hook: If the row was an OCR match that required selection/manual,
    // persist raw_ocr_text -> medicine_id asynchronously without blocking UI
    if (
      confirmedRow.source === "ocr" &&
      confirmedRow.raw_text &&
      confirmedRow.matched_medicine_id &&
      (confirmedRow.match_status === "needs_selection" ||
        confirmedRow.match_status === "manual_required")
    ) {
      recordOcrAlias(confirmedRow.raw_text, confirmedRow.matched_medicine_id);
    }

    // Unlock and fetch alternatives if medicine_id is valid
    if (confirmedRow.matched_medicine_id) {
      fetchAlternativesForRow(confirmedRow.temp_id, confirmedRow.matched_medicine_id);
    }
  };

  // Unconfirm row (re-verify)
  const handleUnconfirmRow = (rowId: string) => {
    setRows((prev) =>
      prev.map((r) =>
        r.temp_id === rowId
          ? {
              ...r,
              isConfirmed: false,
              selected_alternative_id: null,
            }
          : r
      )
    );
  };

  // Select alternative
  const handleSelectAlternative = (
    rowId: string,
    alternativeId: string | null
  ) => {
    setRows((prev) =>
      prev.map((r) =>
        r.temp_id === rowId
          ? {
              ...r,
              selected_alternative_id: alternativeId,
            }
          : r
      )
    );
  };

  // Update row details
  const handleUpdateMedicine = (
    rowId: string,
    updated: Partial<ReviewRowState>
  ) => {
    setRows((prev) =>
      prev.map((r) => (r.temp_id === rowId ? { ...r, ...updated } : r))
    );
  };

  // Remove row
  const handleRemoveRow = (rowId: string) => {
    setRows((prev) => prev.filter((r) => r.temp_id !== rowId));
  };

  // Handle type-ahead search for adding medicine directly
  const handleTypeaheadSearch = async (query: string) => {
    setTypeaheadQuery(query);
    if (!query.trim() || query.trim().length < 2) {
      setTypeaheadResults([]);
      return;
    }

    setIsSearchingTypeahead(true);
    try {
      const res = await fetch(
        `/api/medicines/search?q=${encodeURIComponent(query.trim())}&limit=6`
      );
      if (res.ok) {
        const data = await res.json();
        setTypeaheadResults(data.medicines || []);
      }
    } catch (err) {
      console.warn("Direct medicine search error:", err);
    } finally {
      setIsSearchingTypeahead(false);
    }
  };

  // Add a medicine directly from catalog search
  const handleAddFromSearch = (med: MedicineSearchItem) => {
    const newRowId = `manual_${rows.length + 1}_${med.id}`;
    const newRow: ReviewRowState = {
      temp_id: newRowId,
      source: "manual_search",
      raw_text: med.brand_name,
      match_status: "exact",
      dose: null,
      duration: null,

      matched_medicine_id: med.id,
      brand_name: med.brand_name,
      composition_display: med.composition_display,
      composition_key: med.composition_key,
      mrp: med.mrp,
      is_jan_aushadhi: med.is_jan_aushadhi,
      is_nti: med.is_nti,
      is_schedule_h: med.is_schedule_h,

      is_custom: false,
      isConfirmed: true, // Direct search additions are already confirmed

      alternativesLoading: true,
      alternativesGroup: null,
      selected_alternative_id: null,
    };

    setRows((prev) => [...prev, newRow]);
    setIsAddingMedicine(false);
    setTypeaheadQuery("");
    setTypeaheadResults([]);

    // Fetch alternatives immediately
    fetchAlternativesForRow(newRowId, med.id);
  };

  // Summary Metrics & Gated Verification Check
  const totalRowsCount = rows.length;
  const confirmedRowsCount = rows.filter((r) => r.isConfirmed).length;
  const allConfirmed = totalRowsCount > 0 && confirmedRowsCount === totalRowsCount;
  const unconfirmedCount = totalRowsCount - confirmedRowsCount;

  // Compute Total MRP and Total Savings
  const { totalOriginalMrp, totalFinalMrp, totalSavings } = useMemo(() => {
    let orig = 0;
    let final = 0;

    for (const r of rows) {
      const baseMrp = Number(r.mrp) || 0;
      orig += baseMrp;

      if (r.selected_alternative_id && r.alternativesGroup) {
        // Find selected alternative mrp
        const allAlts = [
          ...(r.alternativesGroup.janAushadhiOptions || []),
          ...(r.alternativesGroup.lowerPriceAlternatives || []),
        ];
        const alt = allAlts.find((a) => a.id === r.selected_alternative_id);
        if (alt) {
          final += Number(alt.mrp) || 0;
        } else {
          final += baseMrp;
        }
      } else {
        final += baseMrp;
      }
    }

    const savings = Math.max(0, orig - final);
    return {
      totalOriginalMrp: Number(orig.toFixed(2)),
      totalFinalMrp: Number(final.toFixed(2)),
      totalSavings: Number(savings.toFixed(2)),
    };
  }, [rows]);

  // Handle final handoff to downstream P3 /api/plans
  const handleProceed = () => {
    if (!allConfirmed) return;

    const payload: ConfirmedMedicine[] = rows.map((r) => {
      let altBrandName: string | null = null;
      let altMrp: number | null = null;

      if (r.selected_alternative_id && r.alternativesGroup) {
        const allAlts = [
          ...(r.alternativesGroup.janAushadhiOptions || []),
          ...(r.alternativesGroup.lowerPriceAlternatives || []),
        ];
        const found = allAlts.find((a) => a.id === r.selected_alternative_id);
        if (found) {
          altBrandName = found.brand_name;
          altMrp = found.mrp;
        }
      }

      return {
        medicine_id: r.matched_medicine_id || r.temp_id,
        brand_name: r.brand_name,
        composition_key: r.composition_key || "custom",
        strength: r.custom_strength || null,
        dosage: r.dose,
        mrp: r.mrp,
        selected_alternative_id: r.selected_alternative_id,
        selected_alternative_brand_name: altBrandName,
        selected_alternative_mrp: altMrp,
        is_nti: r.is_nti,
        is_schedule_h: r.is_schedule_h,
      };
    });

    if (onContinueToPlan) {
      onContinueToPlan(payload);
    }
  };

  return (
    <div className={`w-full max-w-4xl mx-auto space-y-6 ${className}`}>
      {/* ----------------- Top Header & Actions ----------------- */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-emerald-600" />
            Prescription Review & Medicine Confirmation
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Verify prescribed medicines first, then choose lower-price or Jan Aushadhi generic options.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setIsAddingMedicine((prev) => !prev)}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition-colors"
        >
          <Plus className="h-4 w-4" /> Add Medicine
        </button>
      </div>

      {/* ----------------- Unified Entry: Direct Type-Ahead Drawer ----------------- */}
      {isAddingMedicine && (
        <div className="rounded-xl border border-sky-300 bg-sky-50/50 p-4 space-y-3 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-sky-950 flex items-center gap-1.5">
              <Search className="h-4 w-4 text-sky-600" /> Add Medicine Directly via Catalog Search
            </span>
            <button
              type="button"
              onClick={() => {
                setIsAddingMedicine(false);
                setTypeaheadResults([]);
              }}
              className="text-xs text-slate-500 hover:text-slate-800"
            >
              Close
            </button>
          </div>

          <div className="relative">
            <input
              type="text"
              value={typeaheadQuery}
              onChange={(e) => handleTypeaheadSearch(e.target.value)}
              placeholder="Search by brand (e.g. Dolo 650, Pan 40) or salt (e.g. Paracetamol)..."
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-4 text-sm placeholder-slate-400 focus:border-sky-500 focus:outline-hidden focus:ring-1 focus:ring-sky-500 shadow-xs"
              autoFocus
            />
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            {isSearchingTypeahead && (
              <RefreshCw className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-slate-400" />
            )}
          </div>

          {typeaheadResults.length > 0 && (
            <div className="max-h-56 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white shadow-sm">
              {typeaheadResults.map((med) => (
                <button
                  key={med.id}
                  type="button"
                  onClick={() => handleAddFromSearch(med)}
                  className="w-full p-3 text-left hover:bg-sky-50/60 flex items-center justify-between transition-colors text-xs"
                >
                  <div>
                    <div className="font-semibold text-slate-900 text-sm">
                      {med.brand_name}
                    </div>
                    <div className="text-slate-500 text-xs mt-0.5">
                      {med.composition_display}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-slate-900 text-sm">
                      ₹{med.mrp.toFixed(2)}
                    </span>
                    {med.is_jan_aushadhi && (
                      <span className="block text-[10px] text-teal-600 font-semibold">
                        Jan Aushadhi
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ----------------- Progress Bar: X of Y Confirmed ----------------- */}
      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-700">
            Medicine Verification Progress:
          </span>
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              allConfirmed
                ? "bg-emerald-100 text-emerald-800"
                : "bg-amber-100 text-amber-800"
            }`}
          >
            {confirmedRowsCount} of {totalRowsCount} Confirmed
          </span>
        </div>

        {/* Progress bar line */}
        <div className="w-full sm:w-48 bg-slate-200 h-2 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              allConfirmed ? "bg-emerald-500" : "bg-amber-500"
            }`}
            style={{
              width: `${totalRowsCount > 0 ? (confirmedRowsCount / totalRowsCount) * 100 : 0}%`,
            }}
          />
        </div>
      </div>

      {/* ----------------- List of Medicine Review Cards ----------------- */}
      <div className="space-y-4">
        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center space-y-3 bg-white">
            <Info className="h-8 w-8 text-slate-400 mx-auto" />
            <h3 className="font-semibold text-slate-800">No medicines in review list</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Scan a prescription or click &ldquo;Add Medicine&rdquo; above to search and compare prices.
            </p>
            <button
              type="button"
              onClick={() => setIsAddingMedicine(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 transition-colors"
            >
              <Plus className="h-4 w-4" /> Add Medicine
            </button>
          </div>
        ) : (
          rows.map((row) => (
            <MedicineReviewRow
              key={row.temp_id}
              row={row}
              onConfirmRow={handleConfirmRow}
              onUnconfirmRow={handleUnconfirmRow}
              onSelectAlternative={handleSelectAlternative}
              onUpdateMedicine={handleUpdateMedicine}
              onRemoveRow={handleRemoveRow}
            />
          ))
        )}
      </div>

      {/* ----------------- Gated Handoff Bar ----------------- */}
      {rows.length > 0 && (
        <div className="sticky bottom-4 z-10 rounded-2xl border border-slate-200 bg-white/95 backdrop-blur-md p-4 sm:p-5 shadow-lg space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-xs text-slate-500">Estimated Total Order Value:</div>
              <div className="flex items-baseline gap-2 mt-0.5">
                <span className="text-2xl font-black text-slate-900">
                  ₹{totalFinalMrp.toFixed(2)}
                </span>
                {totalSavings > 0 && (
                  <span className="text-xs font-semibold text-slate-400 line-through">
                    ₹{totalOriginalMrp.toFixed(2)}
                  </span>
                )}
                {totalSavings > 0 && (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-800">
                    Saving ₹{totalSavings.toFixed(2)}
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-col sm:items-end gap-1">
              <button
                type="button"
                disabled={!allConfirmed}
                onClick={handleProceed}
                className={`inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 font-semibold text-sm transition-all shadow-md ${
                  allConfirmed
                    ? "bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer hover:shadow-lg"
                    : "bg-slate-200 text-slate-400 cursor-not-allowed"
                }`}
              >
                <span>Continue to Pharmacy Plan</span>
                <ArrowRight className="h-4 w-4" />
              </button>

              {!allConfirmed && (
                <span className="text-[11px] text-amber-700 font-medium">
                  Confirm all {unconfirmedCount} medicine(s) above to continue
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
