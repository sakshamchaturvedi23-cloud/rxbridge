/**
 * src/lib/clinical/medicine-search.ts
 *
 * Core clinical medicine search and same-salt / Jan Aushadhi alternatives grouping module.
 * Part A:
 * 1. Type-ahead medicine search by brand_name or composition_display
 * 2. Same-salt alternatives grouped into:
 *    - lowerPriceAlternatives: cheaper non-Jan Aushadhi branded alternatives (sorted cheapest first)
 *    - janAushadhiOptions: PMBI generic alternatives (sorted cheapest first)
 *    - otherSameSaltBrands: same-salt reference options (equal/higher price, sorted by price)
 * 3. NTI (Narrow Therapeutic Index) clinical safety lock enforcing Do-Not-Substitute
 *
 * Owner: P2 (AI Extraction, Clinical Rules & Data Owner)
 * Branch: p2-ai-data
 */

import type { Database } from "@/types/database.types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConfirmedMedicine } from "@/types/contracts";
import { isNtiComposition } from "./nti-list";

export type { ConfirmedMedicine };

export type MedicineRecord = Database["public"]["Tables"]["medicines"]["Row"];

export const MEDICINE_SEARCH_FIELDS =
  "id, brand_name, manufacturer, pack_size, composition_display, composition_key, mrp, is_jan_aushadhi, is_nti, is_schedule_h" as const;

export interface MedicineSearchItem {
  id: string;
  brand_name: string;
  manufacturer: string | null;
  pack_size: string | null;
  composition_display: string;
  composition_key: string;
  mrp: number;
  is_jan_aushadhi: boolean;
  is_nti: boolean;
  is_schedule_h: boolean;
}

export interface MedicineReference {
  id: string;
  composition_key: string;
  mrp: number;
  brand_name?: string;
  composition_display?: string;
  is_jan_aushadhi?: boolean;
  is_nti?: boolean;
  is_schedule_h?: boolean;
}

export interface AlternativeMedicineItem extends MedicineSearchItem {
  savings: number;
  savings_pct: number;
}

export interface SameSaltAlternativesGroup {
  selectedMedicine?: MedicineSearchItem | MedicineReference;
  is_nti: boolean;
  substitution_allowed: boolean;
  substitution_blocked_reason: string | null;
  /** Same composition_key, is_jan_aushadhi === false, mrp > 0 and mrp < selected.mrp (sorted cheapest first) */
  lowerPriceAlternatives: AlternativeMedicineItem[];
  /** Same composition_key, is_jan_aushadhi === true (sorted by mrp ascending) */
  janAushadhiOptions: AlternativeMedicineItem[];
  /** Remaining same-composition matches for reference (excluding selected, equal/higher mrp non-Jan Aushadhi) */
  otherSameSaltBrands: AlternativeMedicineItem[];
  /** Total count of all alternative choices found (excluding the selected medicine) */
  totalOptionsCount: number;
}

export interface SearchMedicinesOptions {
  limit?: number;
  excludeNti?: boolean;
  isJanAushadhiOnly?: boolean;
}

export interface GetSameSaltOptions {
  /** If true (default), NTI drugs will have alternatives arrays empty and substitution_allowed: false */
  enforceNtiLock?: boolean;
}

/**
 * Sanitizes input query string to prevent PostgREST .or() filter syntax breakage.
 * Strips commas, colons, parentheses, brackets, quotes, and structural filter characters.
 */
export function sanitizeSearchQuery(input: string): string {
  if (!input || typeof input !== "string") return "";
  return input
    .replace(/[(),":\\;.[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Computes savings and savings percentage relative to a selected medicine's MRP.
 */
export function calculateSavings(
  baseMrp: number,
  candidateMrp: number
): { savings: number; savings_pct: number } {
  const rawSavings = baseMrp - candidateMrp;
  if (baseMrp <= 0 || rawSavings <= 0) {
    return { savings: 0, savings_pct: 0 };
  }
  const savings = Number(rawSavings.toFixed(2));
  const savings_pct = Number(((rawSavings / baseMrp) * 100).toFixed(1));
  return { savings, savings_pct };
}

/**
 * Ranks type-ahead search results so brand name prefix matches rank higher than composition matches.
 */
function rankSearchResults(
  items: MedicineSearchItem[],
  normalizedQuery: string
): MedicineSearchItem[] {
  const lowerQ = normalizedQuery.toLowerCase();

  return [...items].sort((a, b) => {
    const aBrand = a.brand_name.toLowerCase();
    const bBrand = b.brand_name.toLowerCase();
    const aComp = a.composition_display.toLowerCase();
    const bComp = b.composition_display.toLowerCase();

    // 1. Exact brand match
    const aBrandExact = aBrand === lowerQ ? 1 : 0;
    const bBrandExact = bBrand === lowerQ ? 1 : 0;
    if (aBrandExact !== bBrandExact) return bBrandExact - aBrandExact;

    // 2. Brand starts with query
    const aBrandStarts = aBrand.startsWith(lowerQ) ? 1 : 0;
    const bBrandStarts = bBrand.startsWith(lowerQ) ? 1 : 0;
    if (aBrandStarts !== bBrandStarts) return bBrandStarts - aBrandStarts;

    // 3. Word in brand starts with query
    const aWordStarts = aBrand.split(/\s+/).some((w) => w.startsWith(lowerQ)) ? 1 : 0;
    const bWordStarts = bBrand.split(/\s+/).some((w) => w.startsWith(lowerQ)) ? 1 : 0;
    if (aWordStarts !== bWordStarts) return bWordStarts - aWordStarts;

    // 4. Brand contains query
    const aBrandContains = aBrand.includes(lowerQ) ? 1 : 0;
    const bBrandContains = bBrand.includes(lowerQ) ? 1 : 0;
    if (aBrandContains !== bBrandContains) return bBrandContains - aBrandContains;

    // 5. Composition starts with query
    const aCompStarts = aComp.startsWith(lowerQ) ? 1 : 0;
    const bCompStarts = bComp.startsWith(lowerQ) ? 1 : 0;
    if (aCompStarts !== bCompStarts) return bCompStarts - aCompStarts;

    // 6. Tiebreaker: MRP ascending
    return a.mrp - b.mrp;
  });
}

/**
 * Type-ahead search for medicines by brand_name or composition_display.
 *
 * @param supabase Authenticated or admin Supabase client
 * @param query Search query text
 * @param options Limit and filter options
 * @returns Array of matching medicines ranked by clinical relevance and price
 */
export async function searchMedicines(
  supabase: SupabaseClient<Database>,
  query: string,
  options?: SearchMedicinesOptions
): Promise<MedicineSearchItem[]> {
  const sanitized = sanitizeSearchQuery(query);
  if (!sanitized) {
    return [];
  }

  const limit = Math.min(Math.max(options?.limit ?? 20, 1), 50);

  let queryBuilder = supabase
    .from("medicines")
    .select(MEDICINE_SEARCH_FIELDS)
    .or(`brand_name.ilike.%${sanitized}%,composition_display.ilike.%${sanitized}%`)
    .limit(limit * 2); // Fetch extra for client-side ranking, then slice

  if (options?.excludeNti) {
    queryBuilder = queryBuilder.eq("is_nti", false);
  }

  if (options?.isJanAushadhiOnly !== undefined) {
    queryBuilder = queryBuilder.eq("is_jan_aushadhi", options.isJanAushadhiOnly);
  }

  const { data, error } = await queryBuilder;

  if (error) {
    throw new Error(`Medicine search query failed: ${error.message}`);
  }

  if (!data || data.length === 0) {
    return [];
  }

  const ranked = rankSearchResults(data as MedicineSearchItem[], sanitized);
  return ranked.slice(0, limit);
}

/**
 * Pure grouping logic for same-salt alternatives given a selected medicine and candidate rows.
 * Separates into:
 * - lowerPriceAlternatives: same composition_key, non-Jan Aushadhi, mrp > 0 and < selected.mrp (cheapest first)
 * - janAushadhiOptions: same composition_key, Jan Aushadhi generic (cheapest first)
 * - otherSameSaltBrands: remaining same-composition matches (reference / equal or higher mrp)
 *
 * Enforces strict NTI Do-Not-Substitute safety locking when enforceNtiLock is true.
 */
export function groupSameSaltMedicines(
  selectedMedicine: MedicineReference,
  candidateMedicines: MedicineSearchItem[],
  options?: GetSameSaltOptions
): SameSaltAlternativesGroup {
  const enforceNtiLock = options?.enforceNtiLock !== false;

  // Verify NTI status from medicine record or clinical reference list
  const isNti =
    Boolean(selectedMedicine.is_nti) ||
    isNtiComposition(selectedMedicine.composition_key) ||
    (selectedMedicine.composition_display
      ? isNtiComposition(selectedMedicine.composition_display)
      : false) ||
    (selectedMedicine.brand_name ? isNtiComposition(selectedMedicine.brand_name) : false);

  if (isNti && enforceNtiLock) {
    return {
      selectedMedicine,
      is_nti: true,
      substitution_allowed: false,
      substitution_blocked_reason:
        "Narrow Therapeutic Index drug — do not substitute without doctor approval",
      lowerPriceAlternatives: [],
      janAushadhiOptions: [],
      otherSameSaltBrands: [],
      totalOptionsCount: 0,
    };
  }

  const lowerPriceAlternatives: AlternativeMedicineItem[] = [];
  const janAushadhiOptions: AlternativeMedicineItem[] = [];
  const otherSameSaltBrands: AlternativeMedicineItem[] = [];

  const baseMrp = Number(selectedMedicine.mrp) || 0;

  for (const cand of candidateMedicines) {
    // Exclude the selected medicine itself
    if (cand.id === selectedMedicine.id) {
      continue;
    }

    // Must match the exact composition_key
    if (cand.composition_key !== selectedMedicine.composition_key) {
      continue;
    }

    const { savings, savings_pct } = calculateSavings(baseMrp, cand.mrp);
    const item: AlternativeMedicineItem = {
      ...cand,
      savings,
      savings_pct,
    };

    if (cand.is_jan_aushadhi) {
      // Jan Aushadhi option
      janAushadhiOptions.push(item);
    } else if (baseMrp > 0 && cand.mrp > 0 && cand.mrp < baseMrp) {
      // Lower price commercial branded alternative
      lowerPriceAlternatives.push(item);
    } else {
      // Other same-salt brands (equal or higher price, or unpriced)
      otherSameSaltBrands.push(item);
    }
  }

  // Sort cheapest first
  lowerPriceAlternatives.sort((a, b) => a.mrp - b.mrp);
  janAushadhiOptions.sort((a, b) => a.mrp - b.mrp);
  otherSameSaltBrands.sort((a, b) => a.mrp - b.mrp);

  const totalOptionsCount =
    lowerPriceAlternatives.length + janAushadhiOptions.length + otherSameSaltBrands.length;

  return {
    selectedMedicine,
    is_nti: isNti,
    substitution_allowed: !isNti,
    substitution_blocked_reason: isNti
      ? "Narrow Therapeutic Index drug — do not substitute without doctor approval"
      : null,
    lowerPriceAlternatives,
    janAushadhiOptions,
    otherSameSaltBrands,
    totalOptionsCount,
  };
}

/**
 * Queries Supabase for all same-salt medicines matching the selected medicine's composition_key,
 * and groups them into lowerPriceAlternatives, janAushadhiOptions, and otherSameSaltBrands.
 *
 * @param supabase Authenticated or admin Supabase client
 * @param selectedMedicine Confirmed medicine object containing id, composition_key, and mrp
 * @param options Grouping options (e.g. enforceNtiLock)
 */
export async function getSameSaltGroups(
  supabase: SupabaseClient<Database>,
  selectedMedicine: MedicineReference,
  options?: GetSameSaltOptions
): Promise<SameSaltAlternativesGroup> {
  const enforceNtiLock = options?.enforceNtiLock !== false;

  const isNti =
    Boolean(selectedMedicine.is_nti) ||
    isNtiComposition(selectedMedicine.composition_key) ||
    (selectedMedicine.composition_display
      ? isNtiComposition(selectedMedicine.composition_display)
      : false) ||
    (selectedMedicine.brand_name ? isNtiComposition(selectedMedicine.brand_name) : false);

  // Fast clinical path for NTI drugs when lock is enforced
  if (isNti && enforceNtiLock) {
    return {
      selectedMedicine,
      is_nti: true,
      substitution_allowed: false,
      substitution_blocked_reason:
        "Narrow Therapeutic Index drug — do not substitute without doctor approval",
      lowerPriceAlternatives: [],
      janAushadhiOptions: [],
      otherSameSaltBrands: [],
      totalOptionsCount: 0,
    };
  }

  const { data, error } = await supabase
    .from("medicines")
    .select(MEDICINE_SEARCH_FIELDS)
    .eq("composition_key", selectedMedicine.composition_key)
    .neq("id", selectedMedicine.id)
    .order("mrp", { ascending: true });

  if (error) {
    throw new Error(`Failed to query same-salt alternatives: ${error.message}`);
  }

  const candidates = (data ?? []) as MedicineSearchItem[];
  return groupSameSaltMedicines(selectedMedicine, candidates, options);
}

/**
 * Fetches a single medicine by UUID.
 */
export async function getMedicineById(
  supabase: SupabaseClient<Database>,
  medicineId: string
): Promise<MedicineSearchItem | null> {
  const { data, error } = await supabase
    .from("medicines")
    .select(MEDICINE_SEARCH_FIELDS)
    .eq("id", medicineId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch medicine by id ${medicineId}: ${error.message}`);
  }

  return (data as MedicineSearchItem) ?? null;
}

/**
 * Given a medicine UUID, fetches the medicine details and its complete same-salt grouped alternatives.
 */
export async function searchMedicineWithAlternatives(
  supabase: SupabaseClient<Database>,
  medicineId: string,
  options?: GetSameSaltOptions
): Promise<{ medicine: MedicineSearchItem; groups: SameSaltAlternativesGroup } | null> {
  const medicine = await getMedicineById(supabase, medicineId);
  if (!medicine) {
    return null;
  }

  const groups = await getSameSaltGroups(supabase, medicine, options);
  return {
    medicine,
    groups,
  };
}
