"use client";

/**
 * src/components/clinical/MedicineReviewRow.tsx
 *
 * Single medicine review card enforcing:
 * 1. "Right Medicine First": Verifies/confirms the prescribed drug (and hydrates authoritative
 *    metadata before confirming fuzzy suggestions) before unlocking alternatives.
 * 2. Renders clinical `safety_flags` (allergy, condition, interaction, NTI lock, Schedule H)
 *    with mandatory decision-support disclaimers.
 * 3. Displays Jan Aushadhi & lower-cost same-salt proposals with pack-size and unit-price context.
 * 4. Strict NTI (Do-Not-Substitute) clinical lock banner.
 *
 * Owner: P2 (AI Extraction, Clinical Rules & Data Owner)
 * Branch: p2-ai-data
 */

import React, { useRef, useState } from "react";
import {
  CheckCircle2,
  AlertTriangle,
  Lock,
  Search,
  Sparkles,
  Pill,
  ShieldAlert,
  Trash2,
  RefreshCw,
  Edit2,
  Building2,
} from "lucide-react";
import type {
  MedicineMatchStatus,
  MedicineSuggestion,
  SafetyFlag,
} from "@/types/contracts";
import type {
  MedicineSearchItem,
  SameSaltAlternativesGroup,
} from "@/lib/clinical/medicine-search";
import { isValidMedicineUuid } from "@/lib/clinical/review-handoff";

export interface ReviewRowState {
  temp_id: string;
  source: "ocr" | "manual_search";
  raw_text: string;
  match_status: MedicineMatchStatus;
  dose: string | null;
  duration: string | null;
  suggestions?: MedicineSuggestion[];

  // Current matched medicine data
  matched_medicine_id: string | null;
  brand_name: string;
  composition_display: string | null;
  composition_key: string | null;
  mrp: number;
  is_jan_aushadhi: boolean;
  is_nti: boolean;
  is_schedule_h: boolean;
  safety_flags?: SafetyFlag[];

  // Custom medicine flag
  is_custom: boolean;
  custom_strength?: string;

  // Confirmation & hydration state
  isConfirmed: boolean;
  isHydrating?: boolean;
  hydrationError?: string | null;

  // Unlocked alternatives
  alternativesLoading: boolean;
  alternativesGroup: SameSaltAlternativesGroup | null;
  selected_alternative_id: string | null; // null => keep prescribed brand
}

interface MedicineReviewRowProps {
  row: ReviewRowState;
  onConfirmRow: (row: ReviewRowState) => void;
  onUnconfirmRow: (rowId: string) => void;
  onSelectAlternative: (rowId: string, alternativeId: string | null) => void;
  onUpdateMedicine: (rowId: string, updated: Partial<ReviewRowState>) => void;
  onRemoveRow: (rowId: string) => void;
}

const FLAG_CATEGORY_LABELS: Record<SafetyFlag["category"], string> = {
  allergy: "Allergy Alert",
  condition: "Condition Precaution",
  interaction: "Interaction Warning",
  nti_lock: "NTI Lock",
  schedule_h: "Schedule H",
};

export function MedicineReviewRow({
  row,
  onConfirmRow,
  onUnconfirmRow,
  onSelectAlternative,
  onRemoveRow,
}: Omit<MedicineReviewRowProps, "onUpdateMedicine"> & {
  onUpdateMedicine?: (rowId: string, updated: Partial<ReviewRowState>) => void;
}) {
  const [isSearchingCatalog, setIsSearchingCatalog] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogResults, setCatalogResults] = useState<MedicineSearchItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [customName, setCustomName] = useState(row.brand_name || "");
  const [customStrength, setCustomStrength] = useState(row.custom_strength || "");
  const searchAbortRef = useRef<AbortController | null>(null);

  const hasValidCatalogUuid =
    !row.is_custom && isValidMedicineUuid(row.matched_medicine_id);

  // Catalog search with AbortController and error/empty-state handling
  const handleCatalogSearch = async (query: string) => {
    setCatalogQuery(query);
    setSearchError(null);

    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
      searchAbortRef.current = null;
    }

    if (!query.trim() || query.trim().length < 2) {
      setCatalogResults([]);
      setHasSearched(false);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    searchAbortRef.current = controller;
    setIsSearching(true);

    try {
      const res = await fetch(
        `/api/medicines/search?q=${encodeURIComponent(query.trim())}&limit=5`,
        { signal: controller.signal }
      );
      if (controller.signal.aborted) return;

      if (!res.ok) {
        setCatalogResults([]);
        setHasSearched(true);
        setSearchError("Catalog search failed. Please try again.");
        return;
      }

      const data = await res.json();
      setCatalogResults(data.medicines || []);
      setHasSearched(true);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") return;
      console.warn("Catalog search error:", err);
      setCatalogResults([]);
      setHasSearched(true);
      setSearchError("Unable to reach catalog search. Check your connection.");
    } finally {
      if (!controller.signal.aborted) {
        setIsSearching(false);
      }
    }
  };

  const handleOpenCustomMode = () => {
    setCustomName(row.brand_name || "");
    setCustomStrength(row.custom_strength || "");
    setIsCustomMode(true);
  };

  // Select a suggestion or catalog match (defers final confirmation for partial suggestions until hydrated)
  const handleSelectMedicine = (med: MedicineSearchItem | MedicineSuggestion) => {
    const isFullMed = "composition_key" in med;
    const brand = med.brand_name;
    const compDisplay = med.composition_display;
    const compKey = isFullMed ? med.composition_key : null;
    const mrp = isFullMed ? med.mrp : 0;
    const isJanAushadhi = isFullMed ? med.is_jan_aushadhi : false;
    const isNti = isFullMed ? med.is_nti : row.is_nti;
    const isScheduleH = isFullMed ? med.is_schedule_h : row.is_schedule_h;
    const medId = "medicine_id" in med ? med.medicine_id : med.id;

    const updatedRow: ReviewRowState = {
      ...row,
      matched_medicine_id: medId,
      brand_name: brand,
      composition_display: compDisplay,
      composition_key: compKey,
      mrp,
      is_jan_aushadhi: isJanAushadhi,
      is_nti: isNti,
      is_schedule_h: isScheduleH,
      is_custom: false,
      isConfirmed: isFullMed, // Partial fuzzy suggestions wait for hydration in onConfirmRow
      isHydrating: !isFullMed,
      selected_alternative_id: null,
      alternativesLoading: false,
    };

    setIsSearchingCatalog(false);
    setIsCustomMode(false);
    onConfirmRow(updatedRow);
  };

  // Handle custom medicine confirmation (explicitly marked is_custom so non-UUID never leaks to /api/plans)
  const handleConfirmCustom = () => {
    if (!customName.trim()) return;

    const updatedRow: ReviewRowState = {
      ...row,
      matched_medicine_id: null,
      brand_name: customName.trim(),
      composition_display: customStrength.trim() || null,
      composition_key: null,
      mrp: 0,
      is_custom: true,
      custom_strength: customStrength.trim() || undefined,
      isConfirmed: true,
      isHydrating: false,
      selected_alternative_id: null,
      alternativesGroup: null,
    };

    setIsCustomMode(false);
    setIsSearchingCatalog(false);
    onConfirmRow(updatedRow);
  };

  // Render clinical flags (allergy/condition/interaction always shown; schedule_h shown; nti_lock shown when not yet confirmed banner)
  const visibleSafetyFlags = (row.safety_flags ?? []).filter((flag) => {
    if (flag.category === "nti_lock" && row.isConfirmed && row.is_nti) return false;
    return true;
  });

  // Determine active alternative
  const chosenAltId = row.selected_alternative_id;
  const isKeepingPrescribed = chosenAltId === null;

  return (
    <div
      className={`relative rounded-xl border transition-all duration-200 overflow-hidden shadow-xs ${
        row.isConfirmed
          ? "border-emerald-200 bg-white"
          : row.match_status === "needs_selection"
          ? "border-amber-200 bg-amber-50/30"
          : row.match_status === "manual_required"
          ? "border-sky-200 bg-sky-50/20"
          : "border-slate-200 bg-slate-50/30"
      }`}
    >
      {/* ----------------- Top Header Row: Medicine Identity ----------------- */}
      <div className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                row.isConfirmed
                  ? "bg-emerald-100 text-emerald-700"
                  : row.match_status === "needs_selection"
                  ? "bg-amber-100 text-amber-700"
                  : "bg-slate-100 text-slate-700"
              }`}
            >
              {row.isHydrating ? (
                <RefreshCw className="h-5 w-5 animate-spin" />
              ) : row.isConfirmed ? (
                <CheckCircle2 className="h-5 w-5" />
              ) : (
                <Pill className="h-5 w-5" />
              )}
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-slate-900 text-lg">
                  {row.brand_name || row.raw_text || "Unrecognized Medicine"}
                </h3>

                {/* Status Badges */}
                {row.isHydrating ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700 border border-sky-200">
                    <RefreshCw className="h-3 w-3 animate-spin" /> Verifying Safety...
                  </span>
                ) : row.isConfirmed ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 border border-emerald-200">
                    <CheckCircle2 className="h-3 w-3" /> Confirmed
                  </span>
                ) : row.match_status === "auto_matched" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-medium text-teal-700 border border-teal-200">
                    <Sparkles className="h-3 w-3" /> Auto-Matched
                  </span>
                ) : row.match_status === "needs_selection" ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700 border border-amber-200">
                    <AlertTriangle className="h-3 w-3" /> Verify Drug
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                    Manual Selection
                  </span>
                )}

                {row.is_custom && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 border border-slate-300">
                    Custom (Unlinked)
                  </span>
                )}

                {row.is_schedule_h && (
                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700 border border-rose-200">
                    Schedule H
                  </span>
                )}

                {row.is_nti && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-900 border border-amber-300">
                    NTI Lock
                  </span>
                )}
              </div>

              {/* Composition and dosage details */}
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-600">
                {row.composition_display && (
                  <span className="font-medium text-slate-700">
                    {row.composition_display}
                  </span>
                )}
                {row.dose && (
                  <span className="text-slate-500">Dose: {row.dose}</span>
                )}
                {row.duration && (
                  <span className="text-slate-500">Duration: {row.duration}</span>
                )}
                {row.mrp > 0 && (
                  <span className="font-semibold text-slate-900">
                    MRP: ₹{row.mrp.toFixed(2)}
                  </span>
                )}
              </div>

              {/* OCR source hint */}
              {row.source === "ocr" && row.raw_text && (
                <p className="mt-1 text-xs text-slate-400">
                  Prescription text:{" "}
                  <span className="italic font-mono text-slate-500">
                    &ldquo;{row.raw_text}&rdquo;
                  </span>
                </p>
              )}
            </div>
          </div>

          {/* Action buttons on the right */}
          <div className="flex items-center gap-2 self-end sm:self-start">
            {row.isConfirmed ? (
              <button
                type="button"
                onClick={() => onUnconfirmRow(row.temp_id)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                title="Re-verify or change medicine"
              >
                <Edit2 className="h-3 w-3" /> Change
              </button>
            ) : (
              <button
                type="button"
                disabled={row.isHydrating || !hasValidCatalogUuid}
                onClick={() => onConfirmRow(row)}
                title={
                  !hasValidCatalogUuid
                    ? "Select a catalog match or enter custom medicine below first"
                    : "Confirm medicine"
                }
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold shadow-xs transition-colors ${
                  row.isHydrating || !hasValidCatalogUuid
                    ? "bg-slate-200 text-slate-500 cursor-not-allowed"
                    : "bg-emerald-600 text-white hover:bg-emerald-700"
                }`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" /> Confirm Medicine
              </button>
            )}

            <button
              type="button"
              onClick={() => onRemoveRow(row.temp_id)}
              className="p-1.5 text-slate-400 hover:text-rose-600 transition-colors rounded-lg hover:bg-rose-50"
              title="Remove medicine"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* ----------------- Clinical Safety Flags Banner ----------------- */}
        {visibleSafetyFlags.length > 0 && (
          <div className="mt-3 space-y-2">
            {visibleSafetyFlags.map((flag, idx) => {
              const isRed = flag.severity === "red";
              return (
                <div
                  key={`${flag.category}-${idx}`}
                  className={`rounded-lg border px-3 py-2.5 text-xs ${
                    isRed
                      ? "border-rose-300 bg-rose-50 text-rose-950"
                      : "border-amber-200 bg-amber-50/80 text-amber-950"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {isRed ? (
                      <ShieldAlert className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    )}
                    <div className="space-y-0.5">
                      <div className="font-semibold">
                        <span className="uppercase tracking-wide text-[10px] mr-1.5 opacity-80">
                          [{FLAG_CATEGORY_LABELS[flag.category]}]
                        </span>
                        {flag.message}
                      </div>
                      <div className="text-[11px] opacity-80">{flag.disclaimer}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ----------------- State A: UNCONFIRMED Resolution Flow ----------------- */}
        {!row.isConfirmed && (
          <div className="mt-4 border-t border-slate-200/70 pt-4 space-y-3">
            {row.hydrationError && (
              <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-900 flex items-center justify-between gap-2">
                <span>{row.hydrationError}</span>
                {hasValidCatalogUuid && (
                  <button
                    type="button"
                    onClick={() => onConfirmRow({ ...row, hydrationError: null })}
                    className="shrink-0 rounded bg-rose-700 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-800"
                  >
                    Retry
                  </button>
                )}
              </div>
            )}

            {!hasValidCatalogUuid && !row.isHydrating && (
              <div className="rounded-lg border border-sky-200 bg-sky-50/70 px-3 py-2 text-xs text-sky-900">
                Select a matched medicine below or search the catalog so we can verify clinical safety and pharmacy pricing.
              </div>
            )}

            {/* 1. Fuzzy suggestions if available */}
            {row.suggestions && row.suggestions.length > 0 && !isSearchingCatalog && !isCustomMode && (
              <div>
                <p className="text-xs font-medium text-slate-700 mb-1.5 flex items-center gap-1">
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                  Prescription Match Suggestions (Click to verify & confirm):
                </p>
                <div className="flex flex-wrap gap-2">
                  {row.suggestions.map((sug) => (
                    <button
                      key={sug.medicine_id}
                      type="button"
                      disabled={row.isHydrating}
                      onClick={() => handleSelectMedicine(sug)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 hover:border-amber-300 transition-all text-left disabled:opacity-50"
                    >
                      <span>{sug.brand_name}</span>
                      <span className="text-[10px] rounded bg-amber-200/70 px-1 font-mono">
                        {Math.round(sug.similarity * 100)}%
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 2. Type-Ahead Catalog Search Drawer */}
            {isSearchingCatalog ? (
              <div className="rounded-lg border border-sky-200 bg-sky-50/40 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-sky-900 flex items-center gap-1.5">
                    <Search className="h-3.5 w-3.5" /> Search Catalog by Brand or Composition
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsSearchingCatalog(false);
                      setCatalogResults([]);
                    }}
                    className="text-xs text-slate-500 hover:text-slate-800"
                  >
                    Cancel
                  </button>
                </div>

                <div className="relative">
                  <input
                    type="text"
                    value={catalogQuery}
                    onChange={(e) => handleCatalogSearch(e.target.value)}
                    placeholder="e.g. Augmentin 625, Dolo, Pantoprazole..."
                    className="w-full rounded-md border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-sm placeholder-slate-400 focus:border-sky-500 focus:outline-hidden focus:ring-1 focus:ring-sky-500"
                    autoFocus
                  />
                  <Search className="absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
                  {isSearching && (
                    <RefreshCw className="absolute right-2.5 top-2 h-4 w-4 animate-spin text-slate-400" />
                  )}
                </div>

                {searchError && (
                  <p className="text-xs text-rose-700 font-medium">{searchError}</p>
                )}

                {!searchError &&
                  hasSearched &&
                  !isSearching &&
                  catalogResults.length === 0 && (
                    <p className="text-xs text-slate-500 italic">
                      No matching medicines found for &ldquo;{catalogQuery.trim()}&rdquo;.
                    </p>
                  )}

                {catalogResults.length > 0 && (
                  <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
                    {catalogResults.map((med) => (
                      <button
                        key={med.id}
                        type="button"
                        onClick={() => handleSelectMedicine(med)}
                        className="w-full p-2.5 text-left hover:bg-slate-50 flex items-center justify-between transition-colors text-xs"
                      >
                        <div>
                          <div className="font-semibold text-slate-900">
                            {med.brand_name}
                          </div>
                          <div className="text-slate-500 text-[11px]">
                            {med.composition_display}
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="font-bold text-slate-800">
                            ₹{med.mrp.toFixed(2)}
                          </span>
                          {med.is_jan_aushadhi && (
                            <span className="block text-[10px] text-teal-600 font-medium">
                              Jan Aushadhi
                            </span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : isCustomMode ? (
              <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-2">
                <span className="text-xs font-semibold text-slate-800">
                  Enter Custom Prescribed Drug Details (excluded from automated shop plan):
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input
                    type="text"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="Medicine Brand Name"
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                  />
                  <input
                    type="text"
                    value={customStrength}
                    onChange={(e) => setCustomStrength(e.target.value)}
                    placeholder="Strength (e.g. 500mg, 10ml)"
                    className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleConfirmCustom}
                    className="rounded-md bg-slate-800 px-3 py-1 text-xs font-semibold text-white hover:bg-slate-900"
                  >
                    Save & Confirm Custom Drug
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsCustomMode(false)}
                    className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsSearchingCatalog(true)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-800 underline"
                >
                  <Search className="h-3 w-3" /> Search catalog for exact medicine
                </button>
                <span className="text-slate-300">•</span>
                <button
                  type="button"
                  onClick={handleOpenCustomMode}
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-800 underline"
                >
                  Enter manual brand name
                </button>
              </div>
            )}

            {/* Gated locked notice */}
            <div className="rounded-lg bg-slate-100/80 px-3 py-2 text-xs text-slate-500 flex items-center gap-2">
              <Lock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span>
                Cheaper same-salt alternatives & Jan Aushadhi generic options will unlock once this medicine is confirmed.
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ----------------- State B: CONFIRMED Alternatives Flow ----------------- */}
      {row.isConfirmed && (
        <div className="border-t border-slate-100 bg-slate-50/40 p-4 sm:p-5 space-y-4">
          {row.is_custom || !hasValidCatalogUuid ? (
            <div className="rounded-xl border border-slate-200 bg-slate-100/80 p-3.5 text-xs text-slate-700">
              <span className="font-semibold">Unlinked custom entry:</span> This medicine is not linked to a catalog UUID, so automated price comparison and pharmacy plan optimization are unavailable for it. Click &ldquo;Change&rdquo; to search the catalog if needed.
            </div>
          ) : row.is_nti ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 shadow-xs">
              <div className="flex items-start gap-3">
                <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold text-sm text-amber-950 flex items-center gap-1.5">
                    Narrow Therapeutic Index (NTI) Drug — Brand Substitution Clinically Blocked
                  </h4>
                  <p className="mt-1 text-xs text-amber-800 leading-relaxed">
                    {row.alternativesGroup?.substitution_blocked_reason ||
                      "This medicine has a narrow margin between safety and toxicity. Small variations in brand bioavailability can lead to critical therapeutic failures or adverse events. Under clinical guidelines, the prescribed brand must be dispensed."}
                  </p>
                  <p className="mt-2 text-xs font-semibold text-amber-900">
                    Prescribed Brand Preserved: {row.brand_name}
                  </p>
                </div>
              </div>
            </div>
          ) : row.alternativesLoading ? (
            <div className="flex items-center justify-center py-6 text-sm text-slate-500 gap-2">
              <RefreshCw className="h-4 w-4 animate-spin text-emerald-600" />
              Checking Jan Aushadhi & lower-cost same-salt alternatives...
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Select Formula / Brand for Pharmacy Quote
                </h4>
                {chosenAltId && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                    <CheckCircle2 className="h-3 w-3" /> Lower Price Selected
                  </span>
                )}
              </div>

              {/* 1. Prescribed Brand Option */}
              <label
                className={`relative flex items-center justify-between rounded-xl border p-3.5 cursor-pointer transition-all ${
                  isKeepingPrescribed
                    ? "border-emerald-500 bg-emerald-50/30 ring-1 ring-emerald-500"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="flex items-center gap-3">
                  <input
                    type="radio"
                    name={`alt_${row.temp_id}`}
                    checked={isKeepingPrescribed}
                    onChange={() => onSelectAlternative(row.temp_id, null)}
                    className="h-4 w-4 text-emerald-600 focus:ring-emerald-500"
                  />
                  <div>
                    <div className="font-semibold text-slate-900 text-sm">
                      Keep Prescribed: {row.brand_name}
                    </div>
                    <div className="text-xs text-slate-500">
                      Original brand prescribed by doctor
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <span className="font-bold text-slate-800 text-sm">
                    {row.mrp > 0 ? `₹${row.mrp.toFixed(2)}` : "Market Price"}
                  </span>
                  {row.alternativesGroup?.selected_unit_price &&
                    row.alternativesGroup?.selected_unit_label && (
                      <div className="text-[11px] text-slate-500">
                        ₹{row.alternativesGroup.selected_unit_price.toFixed(2)}{" "}
                        {row.alternativesGroup.selected_unit_label}
                      </div>
                    )}
                </div>
              </label>

              {/* 2. Jan Aushadhi Generic Section (Highlighted) */}
              {row.alternativesGroup?.janAushadhiOptions &&
                row.alternativesGroup.janAushadhiOptions.length > 0 && (
                  <div className="rounded-xl border border-teal-200 bg-gradient-to-r from-teal-50/50 to-emerald-50/50 p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-teal-900 uppercase tracking-wide">
                        <Building2 className="h-3.5 w-3.5 text-teal-700" />
                        Pradhan Mantri Jan Aushadhi (PMBI Generic)
                      </span>
                      <span className="text-[10px] font-semibold text-teal-700 bg-teal-100/70 px-2 py-0.5 rounded-full">
                        Govt. Certified Quality
                      </span>
                    </div>

                    <div className="space-y-2">
                      {row.alternativesGroup.janAushadhiOptions.map((janAlt) => {
                        const isSelected = chosenAltId === janAlt.id;
                        return (
                          <label
                            key={janAlt.id}
                            className={`flex items-center justify-between rounded-lg border p-3 cursor-pointer transition-all ${
                              isSelected
                                ? "border-teal-600 bg-white ring-2 ring-teal-500 shadow-xs"
                                : "border-teal-200 bg-white/80 hover:bg-white"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="radio"
                                name={`alt_${row.temp_id}`}
                                checked={isSelected}
                                onChange={() => onSelectAlternative(row.temp_id, janAlt.id)}
                                className="h-4 w-4 text-teal-600 focus:ring-teal-500"
                              />
                              <div>
                                <div className="font-semibold text-slate-900 text-sm">
                                  {janAlt.brand_name}
                                </div>
                                <div className="text-xs text-slate-500">
                                  {janAlt.manufacturer || "PMBI Kendra"}
                                  {janAlt.pack_size ? ` • ${janAlt.pack_size}` : ""}
                                  {janAlt.unit_price && janAlt.unit_label
                                    ? ` (₹${janAlt.unit_price.toFixed(2)} ${janAlt.unit_label})`
                                    : ""}
                                </div>
                              </div>
                            </div>

                            <div className="text-right">
                              <div className="font-bold text-teal-900 text-sm">
                                ₹{janAlt.mrp.toFixed(2)}
                              </div>
                              {janAlt.savings > 0 && (
                                <span className="inline-block rounded-md bg-emerald-100 px-1.5 py-0.5 text-[11px] font-bold text-emerald-800">
                                  Save ₹{janAlt.savings.toFixed(2)} ({janAlt.savings_pct}%)
                                </span>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

              {/* 3. Lower-Price Commercial Branded Alternatives */}
              {row.alternativesGroup?.lowerPriceAlternatives &&
                row.alternativesGroup.lowerPriceAlternatives.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-xs font-semibold text-slate-700 block">
                      Other Verified Cheaper Brands:
                    </span>
                    <div className="space-y-1.5">
                      {row.alternativesGroup.lowerPriceAlternatives.map((alt) => {
                        const isSelected = chosenAltId === alt.id;
                        return (
                          <label
                            key={alt.id}
                            className={`flex items-center justify-between rounded-lg border p-3 cursor-pointer transition-all ${
                              isSelected
                                ? "border-emerald-500 bg-white ring-1 ring-emerald-500 shadow-xs"
                                : "border-slate-200 bg-white hover:border-slate-300"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <input
                                type="radio"
                                name={`alt_${row.temp_id}`}
                                checked={isSelected}
                                onChange={() => onSelectAlternative(row.temp_id, alt.id)}
                                className="h-4 w-4 text-emerald-600 focus:ring-emerald-500"
                              />
                              <div>
                                <div className="font-semibold text-slate-900 text-sm">
                                  {alt.brand_name}
                                </div>
                                <div className="text-xs text-slate-500">
                                  {alt.manufacturer || "Commercial Brand"}
                                  {alt.pack_size ? ` • ${alt.pack_size}` : ""}
                                  {alt.unit_price && alt.unit_label
                                    ? ` (₹${alt.unit_price.toFixed(2)} ${alt.unit_label})`
                                    : ""}
                                </div>
                              </div>
                            </div>

                            <div className="text-right">
                              <div className="font-bold text-slate-900 text-sm">
                                ₹{alt.mrp.toFixed(2)}
                              </div>
                              {alt.savings > 0 && (
                                <span className="inline-block rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-bold text-emerald-700">
                                  Save ₹{alt.savings.toFixed(2)} ({alt.savings_pct}%)
                                </span>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                )}

              {/* No alternatives notice */}
              {(!row.alternativesGroup?.janAushadhiOptions ||
                row.alternativesGroup.janAushadhiOptions.length === 0) &&
                (!row.alternativesGroup?.lowerPriceAlternatives ||
                  row.alternativesGroup.lowerPriceAlternatives.length === 0) && (
                  <p className="text-xs text-slate-500 italic">
                    No lower-cost compatible same-salt alternatives found in catalog. Prescribed brand will be quoted across partner pharmacies.
                  </p>
                )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
