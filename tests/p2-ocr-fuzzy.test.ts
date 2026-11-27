/**
 * tests/p2-ocr-fuzzy.test.ts
 *
 * Phase 3 deterministic unit & integration tests:
 * - fuzzy-match.ts (slash splitting, aliases lookup, dosageHint/dosage-form penalty,
 *   60k / 60,000 strength tokens, auto_matched vs needs_selection vs manual_required thresholds)
 * - ocr-matching.ts (dosage-form prefix stripping, safe prefix tokens, prefix ranking,
 *   demo-cache catalog hydration + offline graceful fallback)
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateBrandSimilarity,
  findFuzzyMedicineMatches,
  normalizeAliasKey,
  stripDosageFormPrefixes,
  type CandidateMedicine,
} from "../src/lib/clinical/fuzzy-match";
import {
  buildAliasLookupMap,
  extractBrandSearchCandidates,
  resolveDemoItemsWithCatalog,
  selectBestPrefixMatch,
} from "../src/lib/clinical/ocr-matching";
import { DEMO_PRESCRIPTIONS } from "../src/lib/clinical/demo-cache";

const SAMPLE_CATALOG: CandidateMedicine[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    brand_name: "Augmentin 625 Duo",
    composition_display: "Amoxicillin 500mg + Clavulanic Acid 125mg",
    composition_key: "amoxicillin-500mg+clavulanic-acid-125mg",
    is_nti: false,
    is_schedule_h: true,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    brand_name: "Dolo 500",
    composition_display: "Paracetamol 500mg",
    composition_key: "paracetamol-500mg",
    is_nti: false,
    is_schedule_h: false,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    brand_name: "Dolo 650",
    composition_display: "Paracetamol 650mg",
    composition_key: "paracetamol-650mg",
    is_nti: false,
    is_schedule_h: false,
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    brand_name: "Uprise-D3 60000IU Capsule",
    composition_display: "Cholecalciferol (60000IU)",
    composition_key: "cholecalciferol-60000iu",
    is_nti: false,
    is_schedule_h: false,
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    brand_name: "Volini Gel",
    composition_display: "Diclofenac (1% w/w)",
    composition_key: "diclofenac-1%",
    is_nti: false,
    is_schedule_h: true,
  },
  {
    id: "66666666-6666-4666-8666-666666666666",
    brand_name: "Voveran 50 Tablet",
    composition_display: "Diclofenac (50mg)",
    composition_key: "diclofenac-50mg",
    is_nti: false,
    is_schedule_h: true,
  },
  {
    id: "77777777-7777-4777-8777-777777777777",
    brand_name: "Eltroxin 100 Tablet",
    composition_display: "Thyroxine (100mcg)",
    composition_key: "levothyroxine-100mcg",
    is_nti: true,
    is_schedule_h: true,
  },
  {
    id: "88888888-8888-4888-8888-888888888888",
    brand_name: "Eltroxin 50 Tablet",
    composition_display: "Thyroxine (50mcg)",
    composition_key: "levothyroxine-50mcg",
    is_nti: true,
    is_schedule_h: true,
  },
  {
    id: "99999999-9999-4999-8999-999999999999",
    brand_name: "Ibugesic Plus",
    composition_display: "Ibuprofen 400mg + Paracetamol 325mg",
    composition_key: "ibuprofen-400mg+paracetamol-325mg",
    is_nti: false,
    is_schedule_h: false,
  },
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    brand_name: "Tabi 500 Tablet",
    composition_display: "Amoxicillin 500mg",
    composition_key: "amoxicillin-500mg",
    is_nti: false,
    is_schedule_h: true,
  },
];

test("fuzzy-match handles slash-splitting, alias lookup, 60k strengths, and thresholds", () => {
  // 1. Slash-splitting picks best alternative query
  const slashResult = findFuzzyMedicineMatches("UnknownBrand / Dolo 650", SAMPLE_CATALOG);
  assert.equal(slashResult.status, "auto_matched");
  assert.equal(slashResult.matchedMedicine?.id, "33333333-3333-4333-8333-333333333333");
  assert.equal(slashResult.matchedAlternative, "Dolo 650");

  // 2. Aliases lookup resolves shorthand like "aug 625" / "Aug-625"
  const aliasMap = buildAliasLookupMap([
    { raw_text: "Tab. Aug 625", brand_name: "Augmentin 625 Duo" },
  ]);
  assert.equal(normalizeAliasKey("Tab. Aug 625"), "aug625");
  assert.equal(normalizeAliasKey("Aug-625"), "aug625");
  const aliasResult = findFuzzyMedicineMatches("Aug-625", SAMPLE_CATALOG, {
    aliases: aliasMap,
  });
  assert.equal(aliasResult.status, "auto_matched");
  assert.equal(aliasResult.matchedMedicine?.brand_name, "Augmentin 625 Duo");

  // 3. 60k strength token matches 60,000 IU
  const vitDScore = calculateBrandSimilarity(
    "Uprise D3 60k",
    "Uprise-D3 60000IU Capsule",
    "Cholecalciferol (60000IU)"
  );
  assert.ok(vitDScore >= 0.9, `Expected >= 0.9 for 60k vs 60000IU, got ${vitDScore}`);

  // 4. Unmatched garbage returns manual_required
  const noneResult = findFuzzyMedicineMatches("XyzCompletelyUnrelatedDrug", SAMPLE_CATALOG);
  assert.equal(noneResult.status, "manual_required");
  assert.equal(noneResult.matchedMedicine, null);
  assert.equal(noneResult.suggestions.length, 0);

  // 5. Partial match (0.68 <= score < 0.9) returns needs_selection
  const partialResult = findFuzzyMedicineMatches("Ibugesic Pl", SAMPLE_CATALOG);
  assert.equal(partialResult.status, "needs_selection");
  assert.equal(partialResult.matchedMedicine, null);
  assert.ok(partialResult.suggestions.some((s) => s.brand_name === "Ibugesic Plus"));
  assert.ok(
    partialResult.suggestions[0].similarity >= 0.68 &&
      partialResult.suggestions[0].similarity < 0.9
  );
});

test("fuzzy-match applies dosageHint dosage-form penalty properly", () => {
  const topicalVsGel = calculateBrandSimilarity(
    "Volini",
    "Volini Gel",
    "Diclofenac (1% w/w)",
    "Local application BD"
  );
  const topicalAsOral = calculateBrandSimilarity(
    "Volini",
    "Volini Gel",
    "Diclofenac (1% w/w)",
    "1 tab HS"
  );
  assert.ok(
    topicalVsGel > topicalAsOral,
    `Expected topical hint (${topicalVsGel}) > oral hint (${topicalAsOral})`
  );
});

test("stripDosageFormPrefixes & extractBrandSearchCandidates never match 'Tab' or 'Cap'", () => {
  assert.equal(stripDosageFormPrefixes("Tab. Azithral 500"), "Azithral 500");
  assert.equal(stripDosageFormPrefixes("Cap Pan-D"), "Pan-D");
  assert.equal(stripDosageFormPrefixes("Syr. Xyzal"), "Xyzal");
  assert.equal(stripDosageFormPrefixes("T. Dolo 650"), "Dolo 650");

  const c1 = extractBrandSearchCandidates("Tab. Azithral", "500mg");
  assert.equal(c1.prefixToken, "Azithral");
  assert.ok(c1.exactQueries.includes("Azithral 500mg"));
  assert.ok(c1.exactQueries.includes("Azithral 500"));

  const c2 = extractBrandSearchCandidates("Tab. 500mg", null);
  assert.equal(c2.prefixToken, null);
});

test("selectBestPrefixMatch picks exact strength Dolo 650 over Dolo 500", () => {
  const doloCandidates = SAMPLE_CATALOG.filter((m) => m.brand_name.startsWith("Dolo"));
  const result = selectBestPrefixMatch("Tab. Dolo 650", doloCandidates, "1 tab SOS");
  assert.equal(result.status, "exact");
  assert.equal(result.matchedMedicine?.brand_name, "Dolo 650");
});

test("resolveDemoItemsWithCatalog hydrates real UUIDs, preserves NTI lock, and supports offline fallback", () => {
  const demoRx1 = DEMO_PRESCRIPTIONS[0];
  const demoRx2 = DEMO_PRESCRIPTIONS[1]; // Contains NTI Eltroxin 50mcg

  const resolved1 = resolveDemoItemsWithCatalog([...demoRx1.items], SAMPLE_CATALOG);
  assert.equal(resolved1[0].matched_medicine_id, "11111111-1111-4111-8111-111111111111");
  assert.equal(resolved1[0].match_status, "exact");
  assert.equal(resolved1[2].matched_medicine_id, "33333333-3333-4333-8333-333333333333");

  // Eltroxin 50mcg must match Eltroxin 50 Tablet (8888...), NOT Eltroxin 100 Tablet (7777...), and preserve allow_alternative=false
  const resolved2 = resolveDemoItemsWithCatalog([...demoRx2.items], SAMPLE_CATALOG);
  assert.equal(resolved2[0].matched_medicine_id, "88888888-8888-4888-8888-888888888888");
  assert.equal(resolved2[0].is_nti, true);
  assert.equal(resolved2[0].allow_alternative, false);

  // Offline empty catalog gracefully preserves original demo items
  const offline = resolveDemoItemsWithCatalog([...demoRx2.items], []);
  assert.equal(offline[0].matched_medicine_id, null);
  assert.equal(offline[0].allow_alternative, false);
});
