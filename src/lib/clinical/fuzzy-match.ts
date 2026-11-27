export interface CandidateMedicine {
  id: string;
  brand_name: string;
  composition_display: string;
  composition_key: string;
  is_nti: boolean;
  is_schedule_h: boolean;
}

export interface SuggestedMatch {
  medicine_id: string;
  brand_name: string;
  composition_display: string;
  similarity: number;
}

export interface FuzzyMatchResult {
  status: "auto_matched" | "needs_selection" | "manual_required";
  matchedMedicine: CandidateMedicine | null;
  suggestions: SuggestedMatch[];
  matchedAlternative?: string;
}

export interface FuzzyMatchOptions {
  autoMatchThreshold?: number;        // default 0.9
  minSuggestionScore?: number;        // default 0.68
  maxSuggestions?: number;            // default 5
  aliases?: Record<string, string>;   // normalized raw_ocr -> canonical brand/query
  dosageHint?: string | null;         // e.g. "Local application", "1 HS", "weekly once"
}

export function normalizeAliasKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/\b(tab|tablet|tablets|cap|capsule|capsules|syr|syrup|inj|injection|drop|drops|gel|cream|oint|ointment|susp|suspension|lotion|spray|sr|er|xr|od|bd|tds|hs|md|ds|dt|plus|forte)\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(mg|mcg|g|gm|ml|iu|%|k)\b/g, " ")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/**
 * Strips leading Indian prescription dosage-form prefixes (e.g. "Tab.", "Cap", "Syr.", "Inj.", "T.", "C.")
 * without stripping meaningful brand words. Used before exact/prefix DB brand lookups.
 */
export function stripDosageFormPrefixes(input: string): string {
  if (!input || typeof input !== "string") return "";
  let cleaned = input.trim();
  // Repeatedly strip leading dosage-form prefixes (e.g. "Tab. ", "Cap ", "Syr. ", "T. ")
  const prefixRegex =
    /^(?:tab(?:let|lets)?|cap(?:sule|sules)?|syr(?:up)?|inj(?:ection)?|susp(?:ension)?|drops?|oint(?:ment)?|gel|cream|lotion|spray|inhaler|t|c)\.?(?:\s+|(?=[A-Z]))/i;
  let prev = "";
  while (cleaned !== prev) {
    prev = cleaned;
    cleaned = cleaned.replace(prefixRegex, "").trim();
  }
  return cleaned.replace(/\s+/g, " ").trim();
}

function extractStrengthTokens(input: string): string[] {
  const normalizedCommas = input.replace(/(\d),(\d)/g, "$1$2");
  const matches = Array.from(
    normalizedCommas
      .toLowerCase()
      .matchAll(/\b(\d+(?:\.\d+)?)(?:\s*(mg|mcg|g|gm|ml|iu|%|k))?\b/g)
  );
  const tokens = new Set<string>();
  for (const m of matches) {
    const rawNum = m[1];
    const unit = (m[2] || "").toLowerCase();
    if (unit === "k") {
      tokens.add(String(Number(rawNum) * 1000));
      tokens.add(`${rawNum}k`);
    } else {
      tokens.add(String(Number(rawNum)));
    }
  }
  return Array.from(tokens);
}

function detectDosageForm(
  text: string
): "topical" | "liquid" | "oral_solid" | "injectable" | "inhaler" | "ophthalmic_otic" | null {
  const t = text.toLowerCase();
  if (/\b(eye\/ear|eye\s+drop|ear\s+drop|ophthalmic|otic|nasal\s+spray|nasal\s+drop)\b/.test(t)) {
    return "ophthalmic_otic";
  }
  if (/\b(inhaler|rotacap|respule|mdi|dpi|nebulizer|nebuliser)\b/.test(t)) {
    return "inhaler";
  }
  if (/\b(inj|injection|vial|ampoule|infusion)\b/.test(t)) {
    return "injectable";
  }
  if (/\b(local application|l\/a|oil|gel|cream|ointment|oint|lotion|spray|tube)\b/.test(t)) {
    return "topical";
  }
  if (/\b(syrup|syr|drop|drops|suspension|susp|solution|elixir)\b/.test(t)) {
    return "liquid";
  }
  if (/\b(tab|tablet|tablets|cap|capsule|capsules|od|bd|tds|hs|1-0-1|1-1-1|0-1-0|0-0-1|1-0-0)\b/.test(t)) {
    return "oral_solid";
  }
  return null;
}

function normalizeBrandForFuzzy(input: string): string {
  return input
    .toLowerCase()
    .replace(
      /\b(tab|tablet|tablets|cap|capsule|capsules|syr|syrup|inj|injection|drop|drops|gel|cream|oint|ointment|oil|susp|suspension|lotion|spray|inhaler|rotacap|sr|er|xr|od|bd|tds|hs)\b/g,
      " "
    )
    .replace(/\b\d+(?:\.\d+)?\s*(mg|mcg|g|gm|ml|iu|%|k)\b/g, " ")
    .replace(/\b\d+(?:\.\d+)?\b/g, " ")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[m][n];
}

export function calculateBrandSimilarity(
  query: string,
  candidateBrand: string,
  candidateComposition = "",
  dosageHint?: string | null
): number {
  const normQuery = normalizeBrandForFuzzy(query);
  const normCandidate = normalizeBrandForFuzzy(candidateBrand);

  if (!normQuery || !normCandidate) return 0;

  const maxLen = Math.max(normQuery.length, normCandidate.length);
  const distance = levenshteinDistance(normQuery, normCandidate);
  let score = normQuery === normCandidate ? 1 : (maxLen - distance) / maxLen;

  if (normQuery.length <= 8 && normQuery[0] !== normCandidate[0]) {
    score = Math.max(0, score - 0.18);
  }

  const queryForm = detectDosageForm(`${query} ${dosageHint || ""}`);
  const candForm = detectDosageForm(`${candidateBrand} ${candidateComposition}`);
  if (queryForm && candForm && queryForm !== candForm) {
    score = Math.max(0, score - 0.2);
  }

  const queryStrengths = extractStrengthTokens(`${query} ${dosageHint || ""}`);
  if (queryStrengths.length > 0) {
    const candidateStrengths = extractStrengthTokens(`${candidateBrand} ${candidateComposition}`);
    if (candidateStrengths.length > 0) {
      const hasExactStrength = queryStrengths.some((s) => candidateStrengths.includes(s));
      if (hasExactStrength) {
        score = Math.min(1, score + 0.04);
      } else {
        score = Math.max(0, score - 0.14);
      }
    } else {
      score = Math.max(0, score - 0.08);
    }
  }

  return Number(score.toFixed(3));
}

function splitAlternativeQueries(query: string): string[] {
  const parts = query
    .split(/[\/|;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts : [query.trim()];
}

export function findFuzzyMedicineMatches(
  query: string,
  catalog: CandidateMedicine[],
  options: FuzzyMatchOptions = {}
): FuzzyMatchResult {
  const autoMatchThreshold = options.autoMatchThreshold ?? 0.9;
  const minSuggestionScore = options.minSuggestionScore ?? 0.68;
  const maxSuggestions = options.maxSuggestions ?? 5;

  if (!query.trim() || catalog.length === 0) {
    return {
      status: "manual_required",
      matchedMedicine: null,
      suggestions: [],
    };
  }

  const candidates = splitAlternativeQueries(query);
  let bestOverall: FuzzyMatchResult = {
    status: "manual_required",
    matchedMedicine: null,
    suggestions: [],
  };
  let bestTopScore = -1;

  for (const part of candidates) {
    const lowerPart = part.trim().toLowerCase();
    const aliasKey = normalizeAliasKey(part);
    const resolvedQuery =
      options.aliases?.[lowerPart] ?? options.aliases?.[aliasKey] ?? part;

    const ranked = catalog
      .map((med) => ({
        med,
        score: calculateBrandSimilarity(
          resolvedQuery,
          med.brand_name,
          med.composition_display,
          options.dosageHint
        ),
      }))
      .filter((entry) => entry.score >= minSuggestionScore)
      .sort((a, b) => b.score - a.score);

    const topScore = ranked[0]?.score ?? 0;
    if (ranked.length > 0 && topScore > bestTopScore) {
      bestTopScore = topScore;
      const suggestions: SuggestedMatch[] = ranked.slice(0, maxSuggestions).map((entry) => ({
        medicine_id: entry.med.id,
        brand_name: entry.med.brand_name,
        composition_display: entry.med.composition_display,
        similarity: entry.score,
      }));

      bestOverall =
        topScore >= autoMatchThreshold
          ? {
              status: "auto_matched",
              matchedMedicine: ranked[0].med,
              suggestions,
              matchedAlternative: part,
            }
          : {
              status: "needs_selection",
              matchedMedicine: null,
              suggestions,
              matchedAlternative: part,
            };
    }
  }

  return bestOverall;
}
