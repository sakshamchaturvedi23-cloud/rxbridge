/**
 * src/lib/clinical/alias-learning.ts
 *
 * Client-side helper for auto-learning patient OCR corrections.
 * Fires asynchronously in the background without blocking UI confirmation.
 *
 * Owner: P2 (AI Extraction, Clinical Rules & Data Owner)
 * Branch: p2-ai-data
 */

export function normalizeAliasRawText(rawText: string): string {
  return rawText.trim().replace(/\s+/g, " ").toLowerCase();
}

export function recordOcrAlias(rawText: string, medicineId: string): void {
  const clean = normalizeAliasRawText(rawText || "");
  if (!clean || clean.length < 2 || !medicineId) return;

  // Non-blocking fire-and-forget
  fetch("/api/medicines/alias", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      raw_text: clean,
      matched_medicine_id: medicineId,
    }),
  }).catch((err) => {
    console.warn("[OCR Alias Learning] Background sync notice:", err);
  });
}
