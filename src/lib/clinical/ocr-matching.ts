/**
 * src/lib/clinical/ocr-matching.ts
 *
 * Pure OCR brand/alias/prefix/demo-cache matching helpers shared by `/api/extract` and P2 tests.
 * Prevents generic dosage-form prefixes ("Tab", "Cap", "Syr", "Inj") from producing false
 * exact matches and resolves demo-cache items to real catalog UUIDs when available.
 *
 * Owner: P2 (AI Extraction, Clinical Rules & Data Owner)
 */

import type {
  ExtractedMedicineItem,
  MedicineSuggestion,
} from "@/types/contracts";
import {
  calculateBrandSimilarity,
  normalizeAliasKey,
  stripDosageFormPrefixes,
  type CandidateMedicine,
} from "./fuzzy-match";
import { extractSaltNames } from "./normalize";

const NON_BRAND_PREFIX_WORDS = new Set([
  "tab",
  "tablet",
  "tablets",
  "cap",
  "capsule",
  "capsules",
  "syr",
  "syrup",
  "inj",
  "injection",
  "drop",
  "drops",
  "gel",
  "cream",
  "oint",
  "ointment",
  "oil",
  "susp",
  "suspension",
  "lotion",
  "spray",
  "inhaler",
  "rotacap",
  "solution",
  "powder",
  "sachet",
]);

export interface BrandSearchCandidates {
  strippedName: string;
  exactQueries: string[];
  prefixToken: string | null;
}

/**
 * Extracts dosage-stripped exact query candidates and a safe brand prefix token
 * (never a generic dosage-form word like "Tab" or "Cap") for Supabase catalog lookup.
 */
export function extractBrandSearchCandidates(
  rawName: string,
  strength?: string | null
): BrandSearchCandidates {
  const stripped = stripDosageFormPrefixes(rawName)
    .replace(/[^a-zA-Z0-9\s./-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const exactSet = new Set<string>();
  if (stripped) {
    exactSet.add(stripped);
    const cleanedPunct = stripped.replace(/[./]/g, " ").replace(/\s+/g, " ").trim();
    if (cleanedPunct) exactSet.add(cleanedPunct);
  }

  const cleanStrength = strength?.trim();
  if (stripped && cleanStrength) {
    const lowerStripped = stripped.toLowerCase();
    const numericStrength = cleanStrength.replace(/[^0-9.]/g, "");
    if (
      !lowerStripped.includes(cleanStrength.toLowerCase()) &&
      (!numericStrength || !lowerStripped.includes(numericStrength))
    ) {
      exactSet.add(`${stripped} ${cleanStrength}`.replace(/\s+/g, " ").trim());
      if (numericStrength) {
        exactSet.add(`${stripped} ${numericStrength}`.replace(/\s+/g, " ").trim());
      }
    }
  }

  const tokens = stripped
    .split(/[\s-]+/)
    .map((t) => t.replace(/[^a-zA-Z0-9]/g, "").trim())
    .filter(Boolean);

  let prefixToken: string | null = null;
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (NON_BRAND_PREFIX_WORDS.has(lower)) continue;
    if (/^\d+(?:\.\d+)?(?:mg|mcg|g|gm|ml|iu|%|k)?$/i.test(lower)) continue;
    if (token.length >= 3) {
      prefixToken = token;
      break;
    }
  }

  return {
    strippedName: stripped,
    exactQueries: Array.from(exactSet),
    prefixToken,
  };
}

/**
 * Ranks prefix-matched DB candidates using similarity + dosageHint + strength tokens
 * instead of blindly accepting `.limit(1)` as an exact match.
 */
export function selectBestPrefixMatch(
  rawQuery: string,
  candidates: CandidateMedicine[],
  dosageHint?: string | null
): {
  status: "exact" | "auto_matched" | "needs_selection" | null;
  matchedMedicine: CandidateMedicine | null;
  suggestions: MedicineSuggestion[];
} {
  if (!rawQuery.trim() || candidates.length === 0) {
    return { status: null, matchedMedicine: null, suggestions: [] };
  }

  const strippedQuery = stripDosageFormPrefixes(rawQuery).toLowerCase();

  // Exact case-insensitive match after dosage-prefix stripping
  const exactHit = candidates.find(
    (c) =>
      c.brand_name.trim().toLowerCase() === strippedQuery ||
      stripDosageFormPrefixes(c.brand_name).toLowerCase() === strippedQuery
  );
  if (exactHit) {
    return {
      status: "exact",
      matchedMedicine: exactHit,
      suggestions: [
        {
          medicine_id: exactHit.id,
          brand_name: exactHit.brand_name,
          composition_display: exactHit.composition_display,
          similarity: 1,
        },
      ],
    };
  }

  const ranked = candidates
    .map((med) => ({
      med,
      score: calculateBrandSimilarity(
        strippedQuery || rawQuery,
        med.brand_name,
        med.composition_display,
        dosageHint
      ),
    }))
    .filter((entry) => entry.score >= 0.68)
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) {
    return { status: null, matchedMedicine: null, suggestions: [] };
  }

  const suggestions: MedicineSuggestion[] = ranked.slice(0, 5).map((entry) => ({
    medicine_id: entry.med.id,
    brand_name: entry.med.brand_name,
    composition_display: entry.med.composition_display,
    similarity: entry.score,
  }));

  if (ranked[0].score >= 0.9) {
    return {
      status: "auto_matched",
      matchedMedicine: ranked[0].med,
      suggestions,
    };
  }

  return {
    status: "needs_selection",
    matchedMedicine: null,
    suggestions,
  };
}

/**
 * Builds a normalized alias lookup dictionary (`raw_text` and `normalizeAliasKey(raw_text)`)
 * mapping OCR shorthand text to target canonical brand names for `findFuzzyMedicineMatches`.
 */
export function buildAliasLookupMap(
  rows: Array<{ raw_text: string; brand_name?: string | null }>
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of rows) {
    const raw = row.raw_text?.trim().toLowerCase();
    const target = row.brand_name?.trim();
    if (!raw || !target) continue;
    map[raw] = target;
    const normKey = normalizeAliasKey(raw);
    if (normKey && !map[normKey]) {
      map[normKey] = target;
    }
  }
  return map;
}

/**
 * Checks whether two salt arrays share the same active pharmaceutical ingredient(s).
 */
function saltsCompatible(itemSalts: string[], candSalts: string[]): boolean {
  if (itemSalts.length === 0 || candSalts.length === 0) return true;
  // Every salt in the demo item must appear in the candidate (or vice versa for single-salt matches)
  return itemSalts.every((s) =>
    candSalts.some((cs) => cs === s || cs.includes(s) || s.includes(cs))
  );
}

/**
 * Resolves demo-cache prescription items against real catalog rows when available,
 * populating `matched_medicine_id` (UUID) and authoritative composition/NTI/Schedule H flags
 * while gracefully keeping unresolved demo items intact if offline.
 */
export function resolveDemoItemsWithCatalog(
  demoItems: ExtractedMedicineItem[],
  catalog: CandidateMedicine[]
): ExtractedMedicineItem[] {
  if (!catalog || catalog.length === 0) {
    return demoItems;
  }

  return demoItems.map((item) => {
    const demoBrandLower = item.brand_name.trim().toLowerCase();
    const demoBrandNorm = demoBrandLower.replace(/[^a-z0-9]/g, "");
    const itemSalts = item.composition_display
      ? extractSaltNames(item.composition_display)
      : [];

    // 1. Exact case-insensitive or punctuation-normalized brand match with salt verification
    let matched: CandidateMedicine | undefined = catalog.find((c) => {
      const candLower = c.brand_name.trim().toLowerCase();
      if (candLower !== demoBrandLower && candLower.replace(/[^a-z0-9]/g, "") !== demoBrandNorm) {
        return false;
      }
      const candSalts = extractSaltNames(c.composition_display);
      return saltsCompatible(itemSalts, candSalts);
    });

    // 2. High-similarity fallback (>= 0.9) constrained to compatible salts (e.g. "Eltroxin 50mcg" -> "Eltroxin 50 Tablet")
    if (!matched) {
      const saltFiltered = catalog.filter((c) =>
        saltsCompatible(itemSalts, extractSaltNames(c.composition_display))
      );
      const ranked = saltFiltered
        .map((c) => ({
          c,
          score: calculateBrandSimilarity(
            item.brand_name,
            c.brand_name,
            c.composition_display,
            item.dose
          ),
        }))
        .filter((r) => r.score >= 0.9)
        .sort((a, b) => b.score - a.score);

      if (ranked.length > 0) {
        matched = ranked[0].c;
      }
    }

    if (!matched) {
      return item;
    }

    const isNti = Boolean(item.is_nti || matched.is_nti);
    const isScheduleH = Boolean(item.is_schedule_h || matched.is_schedule_h);

    return {
      ...item,
      matched_medicine_id: matched.id,
      brand_name: matched.brand_name,
      composition_display: matched.composition_display || item.composition_display,
      composition_key: matched.composition_key || item.composition_key,
      is_nti: isNti,
      is_schedule_h: isScheduleH,
      allow_alternative: isNti ? false : item.allow_alternative,
      match_status: "exact",
    };
  });
}
