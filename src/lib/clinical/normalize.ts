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
 * Extracts clean, lowercase active pharmaceutical ingredient (salt) names from a composition string,
 * stripping dosages, units, release profiles, and parentheses.
 * Designed for clinical classification matching (NTI list and Schedule H verification).
 *
 * Example:
 * "Amoxicillin 500mg IP + Clavulanic Acid 125mg" -> ["amoxicillin", "clavulanic acid"]
 */
export function extractSaltNames(compositionDisplay: string): string[] {
  if (!compositionDisplay || typeof compositionDisplay !== "string") {
    return [];
  }

  return compositionDisplay
    .split("+")
    .map((rawToken) => {
      // 1. Remove parentheses
      let token = rawToken.replace(/[()]/g, " ");

      // 2. Strip pharmacopeia notations (IP, BP, USP)
      token = token.replace(/\b(?:i\.?p\.?|b\.?p\.?|u\.?s\.?p\.?)\.?\b/gi, " ");

      // 3. Strip dosages with units (e.g. 500mg, 125 mg, 0.5 mcg, 10%, 5ml, 60000 IU, 5 billion spores)
      token = token.replace(
        /\b\d+(?:\.\d+)?\s*(?:mg|mcg|µg|ug|g|gm|gms|ml|iu|%|tablets?|capsules?|units?|billion|million|spores?|w\/v|w\/w|v\/v)?(?![a-z])/gi,
        " "
      );

      // 4. Strip release mechanisms if present (SR, ER, PR, CR, XR, XL, IR)
      token = token.replace(/\b(?:sr|er|pr|cr|xr|xl|ir)\b/gi, " ");

      // 5. Strip any remaining numbers, punctuation, slashes, percent
      token = token.replace(/[%/]/g, " ");
      token = token.replace(/\b\d+(?:\.\d+)?\b/g, " ");

      // 6. Lowercase, normalize hyphens to spaces, strip special characters, and collapse spaces
      token = token
        .toLowerCase()
        .replace(/[^a-z\s-]/g, " ")
        .replace(/[-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      return token;
    })
    .filter((token) => token.length > 0);
}
