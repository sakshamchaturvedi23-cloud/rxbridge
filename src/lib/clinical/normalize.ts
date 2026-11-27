/**
 * Deterministically normalizes a medicine composition display string into a canonical composition key.
 *
 * Normalization rules (applied in order):
 * a) Split multi-salt compositions on '+'.
 * b) For each token: remove parentheses '(' and ')', strip trailing pharmacopeia suffixes ('IP', 'BP', 'USP'),
 *    lowercase, and collapse multiple spaces.
 * c) Remove space between numeric strength and unit ('mg', 'mcg', 'g', 'ml', 'iu', '%').
 * d) Trim, replace remaining spaces with hyphens '-', drop empty tokens, sort alphabetically, and join with '+'.
 *
 * Verification examples (all produce "amoxicillin-500mg+clavulanic-acid-125mg"):
 * - "Clavulanic Acid 125 mg + Amoxicillin 500mg"
 * - "Amoxicillin (500mg) + Clavulanic Acid (125mg)"
 * - "Amoxicillin 500mg IP + Clavulanic Acid 125mg"
 */
export function buildCompositionKey(compositionDisplay: string): string {
  if (!compositionDisplay || typeof compositionDisplay !== "string") {
    return "";
  }

  // a) Split multi-salt compositions on '+'
  const rawTokens = compositionDisplay.split("+");

  const normalizedTokens = rawTokens
    .map((rawToken) => {
      // b) Remove parentheses '(' and ')'
      let token = rawToken.replace(/[()]/g, " ");

      // Strip trailing pharmacopeia suffixes (IP, BP, USP)
      token = token.replace(/\b(?:i\.?p\.?|b\.?p\.?|u\.?s\.?p\.?)\.?\s*$/i, "");

      // Lowercase and collapse multiple spaces
      token = token.toLowerCase();
      token = token.replace(/\s+/g, " ").trim();

      // c) Remove space between numeric strength and unit (mg, mcg, g, ml, iu, %)
      token = token.replace(
        /(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|iu|%)(?![a-z])/g,
        "$1$2"
      );

      // d) Trim, replace remaining spaces with hyphens '-', drop empty tokens
      token = token
        .trim()
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");

      return token;
    })
    .filter((token) => token.length > 0);

  // Sort alphabetically and join with '+'
  normalizedTokens.sort((a, b) => a.localeCompare(b));

  return normalizedTokens.join("+");
}

/**
 * Canonical spelling map for common Indian/British vs INN/USAN salt variants.
 * Used for deterministic salt matching across NTI, Schedule H, and clinical safety checks.
 */
export const CANONICAL_SALT_SYNONYMS: Readonly<Record<string, string>> = {
  amoxycillin: "amoxicillin",
  cefalexin: "cephalexin",
  beclometasone: "beclomethasone",
  torasemide: "torsemide",
  phenobarbitone: "phenobarbital",
  frusemide: "furosemide",
  ciclosporin: "cyclosporine",
  cyclosporin: "cyclosporine",
  nicoumalone: "acenocoumarol",
  lignocaine: "lidocaine",
  acetaminophen: "paracetamol",
  albuterol: "salbutamol",
  glyburide: "glibenclamide",
  "sodium valproate": "sodium valproate",
  "thyroxine": "levothyroxine",
  "thyroxine sodium": "levothyroxine sodium",
};

/**
 * Normalizes known British/Indian/INN salt spelling variants within a clean lowercase salt string.
 * Preserves multi-salt words (e.g. "amoxycillin" -> "amoxicillin", "torasemide" -> "torsemide").
 */
export function normalizeSaltSpelling(salt: string): string {
  if (!salt || typeof salt !== "string") return "";

  let normalized = salt.toLowerCase().replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  if (CANONICAL_SALT_SYNONYMS[normalized]) {
    return CANONICAL_SALT_SYNONYMS[normalized];
  }

  for (const [variant, canonical] of Object.entries(CANONICAL_SALT_SYNONYMS)) {
    const regex = new RegExp(`\\b${variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    normalized = normalized.replace(regex, canonical);
  }

  return normalized.replace(/\s+/g, " ").trim();
}

/**
 * Extracts clean, lowercase active pharmaceutical ingredient (salt) names from a composition string,
 * stripping dosages, units, release profiles, and parentheses, and normalizing common spelling variants.
 * Designed for clinical classification matching (NTI list, Schedule H verification, and safety checks).
 *
 * Example:
 * "Amoxycillin 500mg IP + Clavulanic Acid 125mg" -> ["amoxicillin", "clavulanic acid"]
 */
export function extractSaltNames(compositionDisplay: string): string[] {
  if (!compositionDisplay || typeof compositionDisplay !== "string") {
    return [];
  }

  return compositionDisplay
    .split(/[+|]/)
    .map((rawToken) => {
      // 1. Remove parentheses
      let token = rawToken.replace(/[()]/g, " ");

      // 2. Strip pharmacopeia notations (IP, BP, USP)
      token = token.replace(/\b(?:i\.?p\.?|b\.?p\.?|u\.?s\.?p\.?)\.?\b/gi, " ");

      // 3. Strip placeholder/unknown strength markers like NA
      token = token.replace(/\bna\b/gi, " ");

      // 4. Strip dosages with units (e.g. 500mg, 125 mg, 0.5 mcg, 10%, 5ml, 60000 IU, 5 billion spores)
      token = token.replace(
        /\b\d+(?:\.\d+)?\s*(?:mg|mcg|µg|ug|g|gm|gms|ml|iu|%|tablets?|capsules?|units?|billion|million|spores?|w\/v|w\/w|v\/v)?(?![a-z])/gi,
        " "
      );

      // 5. Strip release mechanisms if present (SR, ER, PR, CR, XR, XL, IR)
      token = token.replace(/\b(?:sr|er|pr|cr|xr|xl|ir)\b/gi, " ");

      // 6. Strip any remaining numbers, punctuation, slashes, percent
      token = token.replace(/[%/]/g, " ");
      token = token.replace(/\b\d+(?:\.\d+)?\b/g, " ");

      // 7. Lowercase, normalize hyphens to spaces, strip special characters, and collapse spaces
      token = token
        .toLowerCase()
        .replace(/[^a-z\s-]/g, " ")
        .replace(/[-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      return normalizeSaltSpelling(token);
    })
    .filter((token) => token.length > 0);
}

/**
 * Canonical composition key builder supporting both '+' and '|' delimiters and
 * normalizing common Indian/British salt spelling variants (e.g. amoxycillin -> amoxicillin).
 *
 * Examples:
 * - "Amoxycillin (500mg) + Clavulanic Acid (125mg)" -> "amoxicillin-500mg+clavulanic-acid-125mg"
 * - "aceclofenac (100mg)|paracetamol (500mg)" -> "aceclofenac-100mg+paracetamol-500mg"
 */
export function buildCanonicalCompositionKey(compositionDisplay: string): string {
  if (!compositionDisplay || typeof compositionDisplay !== "string") {
    return "";
  }

  const rawTokens = compositionDisplay.split(/[+|]/);

  const normalizedTokens = rawTokens
    .map((rawToken) => {
      let token = rawToken.replace(/[()]/g, " ");
      token = token.replace(/\b(?:i\.?p\.?|b\.?p\.?|u\.?s\.?p\.?)\.?\s*$/i, "");
      token = token.toLowerCase().replace(/\s+/g, " ").trim();
      token = normalizeSaltSpelling(token);
      token = token.replace(
        /(\d+(?:\.\d+)?)\s*(mg|mcg|µg|ug|g|gm|ml|iu|%)(?![a-z])/g,
        "$1$2"
      );
      token = token
        .trim()
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");
      return token;
    })
    .filter((token) => token.length > 0);

  normalizedTokens.sort((a, b) => a.localeCompare(b));
  return normalizedTokens.join("+");
}

export type DosageForm =
  | "oral_solid"
  | "oral_liquid"
  | "topical"
  | "injectable"
  | "inhaler"
  | "ophthalmic_otic"
  | "unknown";

/**
 * Classifies a medicine's dosage form from brand name, pack size, and composition text.
 */
export function detectDosageForm(
  brandName: string,
  packSize?: string | null,
  compositionDisplay?: string | null
): DosageForm {
  const combined = `${brandName || ""} ${packSize || ""} ${compositionDisplay || ""}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  if (!combined) return "unknown";

  if (
    /\b(eye\/ear|eye\s+drop|ear\s+drop|ophthalmic|otic|nasal\s+spray|nasal\s+drop|eye\s+ointment)\b/.test(
      combined
    )
  ) {
    return "ophthalmic_otic";
  }

  if (/\b(inhaler|rotacap|respule|transhaler|mdi|dpi|nebulizer|nebuliser)\b/.test(combined)) {
    return "inhaler";
  }

  if (/\b(injection|inj\.?|vial|ampoule|infusion|pre-filled\s+syringe|syringe)\b/.test(combined)) {
    return "injectable";
  }

  if (
    /\b(cream|ointment|oint\.?|gel|lotion|tube\s+of|shampoo|dusting\s+powder|soap|local\s+application|l\/a|liniment)\b/.test(
      combined
    )
  ) {
    return "topical";
  }

  if (
    /\b(syrup|syr\.?|suspension|susp\.?|dry\s+syrup|oral\s+solution|oral\s+suspension|oral\s+drops|drops|elixir)\b/.test(
      combined
    ) ||
    /\bbottle\s+of\s+\d+(?:\.\d+)?\s*ml\b/.test(combined)
  ) {
    return "oral_liquid";
  }

  if (
    /\b(tablet|tablets|tab\.?|capsule|capsules|cap\.?|strip\s+of|lozenge|sachet|dt|md)\b/.test(
      combined
    )
  ) {
    return "oral_solid";
  }

  return "unknown";
}

/**
 * Determines whether two dosage forms are clinically compatible for generic/brand comparison.
 * Returns true if either form is "unknown" (missing metadata) or both forms match.
 */
export function areDosageFormsCompatible(formA: DosageForm, formB: DosageForm): boolean {
  if (formA === "unknown" || formB === "unknown") return true;
  return formA === formB;
}

export interface ParsedPackSize {
  count: number | null;
  unit: "unit" | "ml" | "gm" | null;
  raw: string | null;
}

/**
 * Parses Indian medicine pack_size strings (e.g. "strip of 10 tablets", "bottle of 60 ml syrup",
 * "tube of 15 gm cream") into numeric count and measurement unit.
 */
export function parsePackSize(packSize?: string | null): ParsedPackSize {
  if (!packSize || typeof packSize !== "string") {
    return { count: null, unit: null, raw: null };
  }

  const trimmed = packSize.trim();
  if (!trimmed) return { count: null, unit: null, raw: null };

  const mlMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*ml\b/i);
  if (mlMatch) {
    const count = Number(mlMatch[1]);
    return {
      count: Number.isFinite(count) && count > 0 ? count : null,
      unit: "ml",
      raw: trimmed,
    };
  }

  const gmMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*(?:gm|g)\b/i);
  if (gmMatch) {
    const count = Number(gmMatch[1]);
    return {
      count: Number.isFinite(count) && count > 0 ? count : null,
      unit: "gm",
      raw: trimmed,
    };
  }

  const unitMatch = trimmed.match(
    /(\d+(?:\.\d+)?)\s*(?:tablets?|tabs?|capsules?|caps?|sachets?|vials?|ampoules?|rotacaps?|respules?|units?)\b/i
  );
  if (unitMatch) {
    const count = Number(unitMatch[1]);
    return {
      count: Number.isFinite(count) && count > 0 ? count : null,
      unit: "unit",
      raw: trimmed,
    };
  }

  const fallbackNum = trimmed.match(/^(\d+(?:\.\d+)?)$/);
  if (fallbackNum) {
    const count = Number(fallbackNum[1]);
    return {
      count: Number.isFinite(count) && count > 0 ? count : null,
      unit: "unit",
      raw: trimmed,
    };
  }

  return { count: null, unit: null, raw: trimmed };
}

/**
 * Calculates per-unit price (per tablet/capsule, per ml, or per gm) from pack MRP and pack_size.
 */
export function calculateUnitPrice(
  mrp: number,
  packSize?: string | null
): { unitPrice: number | null; unitLabel: string | null; count: number | null } {
  if (!Number.isFinite(mrp) || mrp <= 0) {
    return { unitPrice: null, unitLabel: null, count: null };
  }

  const parsed = parsePackSize(packSize);
  if (!parsed.count || !parsed.unit) {
    return { unitPrice: null, unitLabel: null, count: null };
  }

  const unitPrice = Number((mrp / parsed.count).toFixed(2));
  const unitLabel =
    parsed.unit === "ml" ? "per ml" : parsed.unit === "gm" ? "per gm" : "per unit";

  return { unitPrice, unitLabel, count: parsed.count };
}
