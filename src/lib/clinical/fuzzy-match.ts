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
  similarity: number; // e.g., 0.92 means 92%
}

export interface FuzzyMatchResult {
  status: "auto_matched" | "needs_selection" | "manual_required";
  matchedMedicine: CandidateMedicine | null;
  suggestions: SuggestedMatch[];
}

export interface FuzzyMatchOptions {
  autoMatchThreshold?: number;     // default 0.9 (90%)
  minSuggestionScore?: number;     // default 0.55 (55%)
  maxSuggestions?: number;         // default 5
}

function extractStrengthTokens(input: string): string[] {
  const matches = input.toLowerCase().match(/\b\d+(?:\.\d+)?(?=\s*(?:mg|mcg|g|gm|ml|iu|%|\b))/g);
  return matches ? Array.from(new Set(matches.map((n) => String(Number(n))))) : [];
}

function normalizeBrandForFuzzy(input: string): string {
  return input
    .toLowerCase()
    .replace(
      /\b(tab|tablet|tablets|cap|capsule|capsules|syr|syrup|inj|injection|drop|drops|gel|cream|oint|ointment|sr|er|xr|od|bd|md|ds|dt|plus|forte)\b/g,
      " "
    )
    .replace(/\b\d+(\.\d+)?\s*(mg|mcg|g|gm|ml|iu|%)\b/g, " ")
    .replace(/\b\d+(\.\d+)?\b/g, " ")
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
  candidateComposition = ""
): number {
  const normQuery = normalizeBrandForFuzzy(query);
  const normCandidate = normalizeBrandForFuzzy(candidateBrand);

  if (!normQuery || !normCandidate) return 0;

  const maxLen = Math.max(normQuery.length, normCandidate.length);
  const distance = levenshteinDistance(normQuery, normCandidate);
  let score = normQuery === normCandidate ? 1 : (maxLen - distance) / maxLen;

  const queryStrengths = extractStrengthTokens(query);
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
      // Query specifies a strength (e.g. "Telma 40 mg") but candidate has no strength number (e.g. "Telma H")
      score = Math.max(0, score - 0.08);
    }
  }

  return Number(score.toFixed(3));
}

export function findFuzzyMedicineMatches(
  query: string,
  catalog: CandidateMedicine[],
  options: FuzzyMatchOptions = {}
): FuzzyMatchResult {
  const autoMatchThreshold = options.autoMatchThreshold ?? 0.9;
  const minSuggestionScore = options.minSuggestionScore ?? 0.55;
  const maxSuggestions = options.maxSuggestions ?? 5;

  if (!query.trim() || catalog.length === 0) {
    return {
      status: "manual_required",
      matchedMedicine: null,
      suggestions: [],
    };
  }

  const ranked = catalog
    .map((med) => ({
      med,
      score: calculateBrandSimilarity(query, med.brand_name, med.composition_display),
    }))
    .filter((entry) => entry.score >= minSuggestionScore)
    .sort((a, b) => b.score - a.score);

  if (ranked.length === 0) {
    return {
      status: "manual_required",
      matchedMedicine: null,
      suggestions: [],
    };
  }

  const suggestions: SuggestedMatch[] = ranked.slice(0, maxSuggestions).map((entry) => ({
    medicine_id: entry.med.id,
    brand_name: entry.med.brand_name,
    composition_display: entry.med.composition_display,
    similarity: entry.score,
  }));

  if (ranked[0].score >= autoMatchThreshold) {
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