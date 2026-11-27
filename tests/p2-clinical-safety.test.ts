/**
 * tests/p2-clinical-safety.test.ts
 *
 * Deterministic Phase 1 unit & integration tests for P2 Clinical Safety Engine:
 * - Salt spelling normalization (amoxycillin <-> amoxicillin, Indian/British variants)
 * - NTI & Schedule H classification (including OTC non-false-positive checks)
 * - Catalog sweep verification against data/final_medicine.csv
 * - Patient-specific safety checks (allergies, chronic conditions, drug interactions, NTI lock)
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { extractSaltNames, normalizeSaltSpelling } from "../src/lib/clinical/normalize";
import {
  getMatchedNtiSalts,
  isNtiComposition,
  isScheduleHComposition,
} from "../src/lib/clinical/nti-list";
import {
  CLINICAL_DISCLAIMERS,
  evaluatePrescriptionSafety,
  resolveTextToSalts,
} from "../src/lib/clinical/safety-check";

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

test("normalizeSaltSpelling & extractSaltNames handle Indian/British spelling variants", () => {
  assert.equal(normalizeSaltSpelling("Amoxycillin"), "amoxicillin");
  assert.equal(normalizeSaltSpelling("Torasemide"), "torsemide");
  assert.equal(normalizeSaltSpelling("Cefalexin"), "cephalexin");
  assert.equal(normalizeSaltSpelling("Beclometasone"), "beclomethasone");
  assert.equal(normalizeSaltSpelling("Phenobarbitone"), "phenobarbital");
  assert.equal(normalizeSaltSpelling("Ciclosporin"), "cyclosporine");
  assert.equal(normalizeSaltSpelling("Nicoumalone"), "acenocoumarol");

  assert.deepEqual(
    extractSaltNames("Amoxycillin (500mg) + Clavulanic Acid (125mg)"),
    ["amoxicillin", "clavulanic acid"]
  );
  assert.deepEqual(
    extractSaltNames("aceclofenac (100mg)|paracetamol (500mg)"),
    ["aceclofenac", "paracetamol"]
  );
});

test("NTI classification catches all curated salts and Indian synonyms", () => {
  const positiveCases = [
    "Levothyroxine Sodium 50mcg",
    "Thyroxine (50mcg)",
    "Tacrolimus (0.5mg)",
    "Sodium Valproate (333mg) + Valproic Acid (145mg)",
    "Mycophenolate sodium (360mg)",
    "Clozapine (200mg)",
    "Phenobarbitone (30mg)",
    "Nicoumalone (2mg)",
    "Ciclosporin (50mg)",
    "Warfarin (5mg)",
    "Carbamazepine (200mg)",
    "Digoxin (0.25mg)",
    "Lithium Carbonate (400mg)",
  ];

  for (const comp of positiveCases) {
    assert.equal(isNtiComposition(comp), true, `Expected NTI=true for: ${comp}`);
    assert.equal(isScheduleHComposition(comp), true, `Expected ScheduleH=true for NTI: ${comp}`);
  }

  assert.deepEqual(getMatchedNtiSalts("Thyroxine (50mcg)"), ["levothyroxine"]);
  assert.deepEqual(getMatchedNtiSalts("Paracetamol 650mg"), []);
  assert.equal(isNtiComposition("Paracetamol 650mg"), false);
  assert.equal(isNtiComposition("Telmisartan 40mg"), false);
});

test("Schedule H classification catches Rx classes & spelling variants while keeping OTC false", () => {
  const scheduleHCases = [
    "Amoxycillin (500mg) + Clavulanic Acid (125mg)",
    "Prazosin (2.5mg)",
    "Aceclofenac (100mg) + Paracetamol (500mg)",
    "Rosuvastatin (5mg) + Clopidogrel (75mg)",
    "Torasemide (10mg)",
    "Formoterol (6mcg) + Fluticasone Propionate (125mcg)",
    "Cefalexin (500mg)",
    "Beclometasone (200mcg)",
    "Thiocolchicoside (4mg)",
  ];

  for (const comp of scheduleHCases) {
    assert.equal(isScheduleHComposition(comp), true, `Expected Schedule H=true for: ${comp}`);
  }

  const otcCases = [
    "Paracetamol 650mg",
    "Cetirizine 10mg",
    "Calcium Carbonate 500mg + Vitamin D3 250IU",
    "Ambroxol 30mg + Guaifenesin 100mg",
    "Chlorpheniramine Maleate (NA) + Paracetamol (NA)",
  ];

  for (const comp of otcCases) {
    assert.equal(isScheduleHComposition(comp), false, `Expected Schedule H=false for OTC: ${comp}`);
  }
});

test("Catalog sweep: detects all missed NTI & Schedule H entries in data/final_medicine.csv", () => {
  const csvPath = path.resolve("data/final_medicine.csv");
  const lines = fs.readFileSync(csvPath, "utf8").split(/\r?\n/).filter(Boolean);
  assert.ok(lines.length > 4500, "Expected ~4597 medicine rows in data/final_medicine.csv");

  let detectedNti = 0;
  let detectedScheduleH = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const compDisplay = cols[4] || "";
    if (isNtiComposition(compDisplay)) detectedNti++;
    if (isScheduleHComposition(compDisplay)) detectedScheduleH++;
  }

  // Previously only 27 flagged NTI and 510 Schedule H; updated rules detect >= 135 NTI and >= 3,000 Schedule H
  assert.ok(detectedNti >= 135, `Expected >= 135 NTI detections, got ${detectedNti}`);
  assert.ok(
    detectedScheduleH >= 3000,
    `Expected >= 3000 Schedule H detections, got ${detectedScheduleH}`
  );
});

test("Safety evaluator flags allergies, cross-reactivity, conditions, interactions, and NTI locks", () => {
  const report = evaluatePrescriptionSafety(
    [
      {
        temp_id: "item-1",
        brand_name: "Augmentin 625 Duo",
        composition_display: "Amoxycillin 500mg + Clavulanic Acid 125mg",
      },
      {
        temp_id: "item-2",
        brand_name: "Eltroxin 50mcg",
        composition_display: "Thyroxine 50mcg",
      },
      {
        temp_id: "item-3",
        brand_name: "EcoSprin 75",
        composition_display: "Aspirin 75mg",
      },
      {
        temp_id: "item-4",
        brand_name: "Dolo 650",
        composition_display: "Paracetamol 650mg",
      },
      {
        temp_id: "item-5",
        brand_name: "Combiflam",
        composition_display: "Ibuprofen 400mg + Paracetamol 325mg",
      },
    ],
    {
      allergies: ["Penicillin"],
      chronic_conditions: ["Peptic Ulcer", "Asthma"],
      current_meds: ["Warf 5mg"],
    }
  );

  // Item 1: Penicillin allergy (red) + Schedule H (amber)
  const item1 = report.items[0];
  assert.equal(item1.is_nti, false);
  assert.equal(item1.is_schedule_h, true);
  assert.equal(item1.allow_alternative, true);
  assert.ok(
    item1.safety_flags.some((f) => f.category === "allergy" && f.severity === "red"),
    "Expected red penicillin allergy flag on Augmentin"
  );

  // Item 2: NTI lock on Thyroxine -> allow_alternative MUST be false
  const item2 = report.items[1];
  assert.equal(item2.is_nti, true);
  assert.equal(item2.is_schedule_h, true);
  assert.equal(item2.allow_alternative, false);
  assert.ok(
    item2.safety_flags.some((f) => f.category === "nti_lock" && f.severity === "amber")
  );

  // Item 3: Aspirin + Warfarin (from current_meds "Warf 5mg") -> red interaction + Peptic Ulcer (red condition)
  const item3 = report.items[2];
  assert.ok(
    item3.safety_flags.some((f) => f.category === "interaction" && f.severity === "red"),
    "Expected red warfarin+aspirin bleeding interaction"
  );
  assert.ok(
    item3.safety_flags.some((f) => f.category === "condition" && f.severity === "red"),
    "Expected red peptic ulcer condition warning on aspirin"
  );

  // Item 4 & 5: Duplicate paracetamol intra-prescription interaction
  const item4 = report.items[3];
  assert.ok(
    item4.safety_flags.some(
      (f) => f.category === "interaction" && /Duplicate ingredient/i.test(f.message)
    ),
    "Expected duplicate paracetamol warning between Dolo 650 and Combiflam"
  );

  assert.equal(report.disclaimers.decision_support, CLINICAL_DISCLAIMERS.decision_support);
  assert.equal(report.disclaimers.interaction_coverage, CLINICAL_DISCLAIMERS.interaction_coverage);
  assert.ok(report.summary.red_count >= 4);
  assert.equal(report.summary.nti_count, 1);
});

test("resolveTextToSalts handles mixed current_meds brand and salt strings", () => {
  assert.deepEqual(resolveTextToSalts("Warf 5mg"), ["warfarin"]);
  assert.deepEqual(resolveTextToSalts("Ecosprin 75 + Metoprolol 50"), [
    "aspirin",
    "metoprolol",
  ]);
  assert.deepEqual(resolveTextToSalts("Cefixime 200mg"), ["cefixime"]);
});
