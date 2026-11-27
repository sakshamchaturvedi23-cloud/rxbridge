/**
 * tests/p2-search-alternatives.test.ts
 *
 * Phase 4 deterministic unit & regression tests:
 * - Alias raw_text normalization
 * - Search query sanitization & relevance ranking
 * - Same-salt grouping with NTI safety locks (even when DB is_nti=false)
 * - Dosage-form compatibility filtering (excluding syrups/injections for tablet queries)
 * - Canonical composition equivalence (amoxycillin vs amoxicillin, '|' vs '+')
 * - Pack-size / unit-price metadata population on alternatives
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateSavings,
  groupSameSaltMedicines,
  rankSearchResults,
  sanitizeSearchQuery,
  type MedicineSearchItem,
} from "../src/lib/clinical/medicine-search";
import { normalizeAliasRawText } from "../src/lib/clinical/alias-learning";

const TABLET_AMOXICILLIN: MedicineSearchItem = {
  id: "11111111-1111-4111-8111-111111111111",
  brand_name: "Augmentin 625 Duo",
  manufacturer: "GSK",
  pack_size: "strip of 10 tablets",
  composition_display: "Amoxicillin (500mg) + Clavulanic Acid (125mg)",
  composition_key: "amoxicillin (500mg)|clavulanic acid (125mg)",
  mrp: 223,
  is_jan_aushadhi: false,
  is_nti: false,
  is_schedule_h: true,
};

const CANDIDATES: MedicineSearchItem[] = [
  {
    id: "22222222-2222-4222-8222-222222222222",
    brand_name: "Moxikind-CV 625 Tablet",
    manufacturer: "Mankind",
    pack_size: "strip of 10 tablets",
    composition_display: "Amoxycillin (500mg) + Clavulanic Acid (125mg)",
    composition_key: "amoxycillin (500mg)|clavulanic acid (125mg)",
    mrp: 178,
    is_jan_aushadhi: false,
    is_nti: false,
    is_schedule_h: true,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    brand_name: "Jan Aushadhi Amoxycillin + Clavulanate 625",
    manufacturer: "PMBI (Jan Aushadhi)",
    pack_size: "strip of 10 tablets",
    composition_display: "Amoxicillin 500mg + Clavulanic Acid 125mg",
    composition_key: "amoxicillin-500mg+clavulanic-acid-125mg",
    mrp: 62,
    is_jan_aushadhi: true,
    is_nti: false,
    is_schedule_h: true,
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    brand_name: "Augmentin Duo Oral Suspension",
    manufacturer: "GSK",
    pack_size: "bottle of 30 ml syrup",
    composition_display: "Amoxicillin (500mg) + Clavulanic Acid (125mg)",
    composition_key: "amoxicillin (500mg)|clavulanic acid (125mg)",
    mrp: 68,
    is_jan_aushadhi: false,
    is_nti: false,
    is_schedule_h: true,
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    brand_name: "Clavam 625 Injection",
    manufacturer: "Alkem",
    pack_size: "vial of 1 injection",
    composition_display: "Amoxicillin (500mg) + Clavulanic Acid (125mg)",
    composition_key: "amoxicillin (500mg)|clavulanic acid (125mg)",
    mrp: 110,
    is_jan_aushadhi: false,
    is_nti: false,
    is_schedule_h: true,
  },
  {
    id: "66666666-6666-4666-8666-666666666666",
    brand_name: "Expensive Amoxyclav 625 Tablet",
    manufacturer: "Test Pharma",
    pack_size: "strip of 10 tablets",
    composition_display: "Amoxicillin (500mg) + Clavulanic Acid (125mg)",
    composition_key: "amoxicillin (500mg)|clavulanic acid (125mg)",
    mrp: 250,
    is_jan_aushadhi: false,
    is_nti: false,
    is_schedule_h: true,
  },
];

test("normalizeAliasRawText & sanitizeSearchQuery clean inputs deterministically", () => {
  assert.equal(normalizeAliasRawText("  Tab.   Aug   625 "), "tab. aug 625");
  assert.equal(sanitizeSearchQuery("Dolo, (650); ilike:%"), "Dolo 650 ilike %");
  assert.equal(sanitizeSearchQuery("()[]{}"), "");
});

test("rankSearchResults prioritizes exact & prefix brand matches over composition matches", () => {
  const items: MedicineSearchItem[] = [
    {
      ...TABLET_AMOXICILLIN,
      id: "a",
      brand_name: "Z-Pac",
      composition_display: "Dolo-like compound",
      mrp: 10,
    },
    {
      ...TABLET_AMOXICILLIN,
      id: "b",
      brand_name: "Dolo 650",
      composition_display: "Paracetamol 650mg",
      mrp: 34,
    },
    {
      ...TABLET_AMOXICILLIN,
      id: "c",
      brand_name: "Dolo",
      composition_display: "Paracetamol 500mg",
      mrp: 20,
    },
    {
      ...TABLET_AMOXICILLIN,
      id: "d",
      brand_name: "MyDolo Extra",
      composition_display: "Paracetamol 650mg",
      mrp: 15,
    },
  ];

  const ranked = rankSearchResults(items, "dolo");
  assert.deepEqual(
    ranked.map((r) => r.brand_name),
    ["Dolo", "Dolo 650", "MyDolo Extra", "Z-Pac"]
  );
});

test("groupSameSaltMedicines enforces dosage-form compatibility, canonical matching, and unit pricing", () => {
  const group = groupSameSaltMedicines(TABLET_AMOXICILLIN, CANDIDATES);

  assert.equal(group.is_nti, false);
  assert.equal(group.substitution_allowed, true);
  assert.equal(group.selected_dosage_form, "oral_solid");
  assert.equal(group.selected_unit_price, 22.3);
  assert.equal(group.selected_unit_label, "per unit");
  assert.equal(group.selected_pack_count, 10);

  // Syrup & Injection must be excluded even though composition_key matches
  assert.equal(group.filteredOutIncompatibleCount, 2);
  assert.equal(group.janAushadhiOptions.length, 1);
  assert.equal(group.janAushadhiOptions[0].brand_name, "Jan Aushadhi Amoxycillin + Clavulanate 625");
  assert.equal(group.janAushadhiOptions[0].unit_price, 6.2);

  assert.equal(group.lowerPriceAlternatives.length, 1);
  assert.equal(group.lowerPriceAlternatives[0].brand_name, "Moxikind-CV 625 Tablet");
  assert.equal(group.lowerPriceAlternatives[0].unit_price, 17.8);
  assert.equal(group.lowerPriceAlternatives[0].savings, 45);

  assert.equal(group.otherSameSaltBrands.length, 1);
  assert.equal(group.otherSameSaltBrands[0].brand_name, "Expensive Amoxyclav 625 Tablet");
});

test("groupSameSaltMedicines strictly blocks NTI alternatives even when DB is_nti flag is false", () => {
  const unflaggedNti: MedicineSearchItem = {
    id: "77777777-7777-4777-8777-777777777777",
    brand_name: "Thyrox 50 Tablet",
    manufacturer: "Macleods",
    pack_size: "bottle of 100 tablets",
    composition_display: "Thyroxine (50mcg)",
    composition_key: "thyroxine (50mcg)",
    mrp: 95,
    is_jan_aushadhi: false,
    is_nti: false, // Simulating unflagged DB row
    is_schedule_h: false,
  };

  const altCandidate: MedicineSearchItem = {
    ...unflaggedNti,
    id: "88888888-8888-4888-8888-888888888888",
    brand_name: "Jan Aushadhi Levothyroxine 50",
    mrp: 15,
    is_jan_aushadhi: true,
  };

  const group = groupSameSaltMedicines(unflaggedNti, [altCandidate]);
  assert.equal(group.is_nti, true);
  assert.equal(group.substitution_allowed, false);
  assert.equal(group.janAushadhiOptions.length, 0);
  assert.equal(group.lowerPriceAlternatives.length, 0);
  assert.equal(group.otherSameSaltBrands.length, 0);
  assert.equal(group.totalOptionsCount, 0);
});

test("calculateSavings handles edge cases cleanly", () => {
  assert.deepEqual(calculateSavings(100, 25), { savings: 75, savings_pct: 75 });
  assert.deepEqual(calculateSavings(100, 120), { savings: 0, savings_pct: 0 });
  assert.deepEqual(calculateSavings(0, 25), { savings: 0, savings_pct: 0 });
});
