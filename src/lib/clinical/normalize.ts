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
