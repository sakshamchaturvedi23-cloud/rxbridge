/**
 * tests/p2-normalization-catalog.test.ts
 *
 * Phase 2 deterministic unit & regression tests:
 * - Canonical composition key builder (including '|' & '+' & spelling variants)
 * - Legacy buildCompositionKey preservation
 * - Dosage form classification & compatibility checks
 * - Pack size parser & unit price calculations
 * - Catalog audit dry-run checks on data/final_medicine.csv
 */

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  areDosageFormsCompatible,
  buildCanonicalCompositionKey,
  buildCompositionKey,
  calculateUnitPrice,
  detectDosageForm,
  parsePackSize,
} from "../src/lib/clinical/normalize";
import { auditCatalogRows, loadCatalogCsv } from "../scripts/audit-and-fix-catalog";

test("buildCompositionKey remains backwards-compatible while buildCanonicalCompositionKey unifies '|' and spelling", () => {
  // Preserve existing buildCompositionKey contract
  assert.equal(
    buildCompositionKey("Clavulanic Acid 125 mg + Amoxicillin 500mg"),
    "amoxicillin-500mg+clavulanic-acid-125mg"
  );
  assert.equal(
    buildCompositionKey("Amoxicillin 500mg IP + Clavulanic Acid 125mg"),
    "amoxicillin-500mg+clavulanic-acid-125mg"
  );

  // Unified canonical key handles CSV '|' format, parens, and British/Indian spellings
  assert.equal(
    buildCanonicalCompositionKey("Amoxycillin (500mg) + Clavulanic Acid (125mg)"),
    "amoxicillin-500mg+clavulanic-acid-125mg"
  );
  assert.equal(
    buildCanonicalCompositionKey("amoxycillin (500mg)|clavulanic acid (125mg)"),
    "amoxicillin-500mg+clavulanic-acid-125mg"
  );
  assert.equal(
    buildCanonicalCompositionKey("aceclofenac (100mg)|paracetamol (500mg)"),
    "aceclofenac-100mg+paracetamol-500mg"
  );
  assert.equal(
    buildCanonicalCompositionKey("Torasemide (10mg)"),
    "torsemide-10mg"
  );
});

test("detectDosageForm & areDosageFormsCompatible prevent incompatible form substitutions", () => {
  assert.equal(detectDosageForm("Dolo 650", "strip of 15 tablets"), "oral_solid");
  assert.equal(detectDosageForm("Xyzal Syrup", "bottle of 60 ml Syrup"), "oral_liquid");
  assert.equal(detectDosageForm("Betnovate-C", "tube of 15 gm cream"), "topical");
  assert.equal(detectDosageForm("Maxiflo 125 Inhaler", "1 inhaler"), "inhaler");
  assert.equal(detectDosageForm("Floxibact Eye/Ear Drops", "bottle of 5 ml"), "ophthalmic_otic");
  assert.equal(detectDosageForm("Monocef 1gm Injection", "vial of 1 injection"), "injectable");

  assert.equal(areDosageFormsCompatible("oral_solid", "oral_solid"), true);
  assert.equal(areDosageFormsCompatible("oral_solid", "oral_liquid"), false);
  assert.equal(areDosageFormsCompatible("oral_solid", "topical"), false);
  assert.equal(areDosageFormsCompatible("oral_solid", "unknown"), true);
});

test("parsePackSize & calculateUnitPrice accurately compute per-unit comparisons", () => {
  assert.deepEqual(parsePackSize("strip of 10 tablets"), {
    count: 10,
    unit: "unit",
    raw: "strip of 10 tablets",
  });
  assert.deepEqual(parsePackSize("bottle of 60 ml syrup"), {
    count: 60,
    unit: "ml",
    raw: "bottle of 60 ml syrup",
  });
  assert.deepEqual(parsePackSize("tube of 15 gm cream"), {
    count: 15,
    unit: "gm",
    raw: "tube of 15 gm cream",
  });

  assert.deepEqual(calculateUnitPrice(34, "strip of 15 tablets"), {
    unitPrice: 2.27,
    unitLabel: "per unit",
    count: 15,
  });
  assert.deepEqual(calculateUnitPrice(149.5, "bottle of 60 ml Syrup"), {
    unitPrice: 2.49,
    unitLabel: "per ml",
    count: 60,
  });
});

test("auditCatalogRows produces exact dry-run audit report on data/final_medicine.csv without mutating", () => {
  const rows = loadCatalogCsv(path.resolve("data/final_medicine.csv"));
  const { report } = auditCatalogRows(rows);

  assert.equal(report.mode, "dry_run");
  assert.equal(report.totalRows, 4597);
  assert.equal(report.dataIntegrity.invalidMrpCount, 0);
  assert.equal(report.clinicalFlags.currentNtiTrueCount, 27);
  assert.ok(report.clinicalFlags.missedNtiCount >= 100);
  assert.equal(report.clinicalFlags.currentScheduleHTrueCount, 510);
  assert.ok(report.clinicalFlags.missedScheduleHCount >= 2500);
  assert.equal(report.compositionAudit.malformedNaCompositionCount, 93);
  assert.equal(report.compositionAudit.amoxycillinVariantCount, 92);
  assert.equal(report.compositionAudit.differsFromBuildCompositionKeyCount, 4597);
  assert.equal(report.provenanceAudit.currentManuallyVerifiedTrueCount, 4597);
  assert.equal(report.provenanceAudit.pmbiJanAushadhiCount, 250);
  assert.ok(report.provenanceAudit.nonPmbiFlaggedJanAushadhiCount > 0);
});
