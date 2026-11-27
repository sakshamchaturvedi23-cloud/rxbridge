/**
 * tests/p2-review-integration.test.ts
 *
 * Phase 5 P2-to-P3 Integration & Regression Tests:
 * - UUID integrity (non-UUID temp_ids and custom rows never leak into ConfirmedMedicine / PlanRequest)
 * - NTI lock enforcement during confirmation and PlanRequest conversion
 * - Safety flag merging with clinical disclaimers
 * - confirmedMedicinesToPlanItems() contract invariants
 * - End-to-end P2 pipeline: Demo Cache -> Catalog Resolution -> Safety Check -> ConfirmedMedicine -> PlanRequest
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  confirmedMedicinesToPlanItems,
  type ConfirmedMedicine,
} from "../src/types/contracts";
import {
  buildConfirmedMedicinesPayload,
  buildValidatedPlanRequest,
  isValidMedicineUuid,
  mergeRowClinicalSafetyFlags,
  type ReviewHandoffRowInput,
} from "../src/lib/clinical/review-handoff";
import { DEMO_PRESCRIPTIONS } from "../src/lib/clinical/demo-cache";
import { resolveDemoItemsWithCatalog } from "../src/lib/clinical/ocr-matching";
import { evaluatePrescriptionSafety } from "../src/lib/clinical/safety-check";
import type { CandidateMedicine } from "../src/lib/clinical/fuzzy-match";

const AUGMENTIN_UUID = "fa842009-26d5-4730-8ee1-c0bc4eea35e4";
const JAN_AUSHADHI_AMOX_UUID = "226d6b79-f3ab-44bf-8971-f93d90b70c9e";
const ZEN_200_UUID = "1171f843-a7f6-4de8-9c6b-364b6ea145f7";
const PAND_UUID = "2d79e6c0-db44-4d3a-9aec-b0a963b0827e";
const ELTROXIN_50_UUID = "88888888-8888-4888-8888-888888888888";
const SHELCAL_500_UUID = "99999999-9999-4999-8999-999999999999";

test("isValidMedicineUuid rejects temporary/mock IDs and accepts valid UUIDs", () => {
  assert.equal(isValidMedicineUuid(AUGMENTIN_UUID), true);
  assert.equal(isValidMedicineUuid(ZEN_200_UUID), true);
  assert.equal(isValidMedicineUuid("demo_item_1"), false);
  assert.equal(isValidMedicineUuid("aug_625"), false);
  assert.equal(isValidMedicineUuid("rx_item_0"), false);
  assert.equal(isValidMedicineUuid(""), false);
  assert.equal(isValidMedicineUuid(null), false);
  assert.equal(isValidMedicineUuid(undefined), false);
});

test("mergeRowClinicalSafetyFlags detects unflagged NTI/Schedule H while preserving patient alerts", () => {
  const merged = mergeRowClinicalSafetyFlags(
    [
      {
        severity: "red",
        category: "allergy",
        message: "Allergy contraindication",
        disclaimer: "Confirm with doctor.",
      },
    ],
    {
      brand_name: "Thyrox 50 Tablet",
      composition_display: "Thyroxine (50mcg)",
      is_nti: false, // stale flag
      is_schedule_h: false,
    }
  );

  assert.equal(merged.isNti, true);
  assert.equal(merged.isScheduleH, true);
  assert.ok(merged.safetyFlags.some((f) => f.category === "allergy" && f.severity === "red"));
  assert.ok(merged.safetyFlags.some((f) => f.category === "nti_lock"));
  assert.ok(merged.safetyFlags.some((f) => f.category === "schedule_h"));
});

test("buildConfirmedMedicinesPayload blocks custom/non-UUID rows and enforces NTI lock", () => {
  const rows: ReviewHandoffRowInput[] = [
    {
      temp_id: "demo_item_1",
      matched_medicine_id: AUGMENTIN_UUID,
      brand_name: "Augmentin 625 Duo Tablet",
      composition_display: "Amoxycillin (500mg) + Clavulanic Acid (125mg)",
      composition_key: "amoxycillin (500mg)|clavulanic acid (125mg)",
      dose: "1 tab BD",
      mrp: 223.42,
      is_nti: false,
      is_schedule_h: true,
      is_custom: false,
      isConfirmed: true,
      selected_alternative_id: JAN_AUSHADHI_AMOX_UUID,
      alternativesGroup: {
        janAushadhiOptions: [
          {
            id: JAN_AUSHADHI_AMOX_UUID,
            brand_name: "Amoxycillin 500mg + Clavulanic Acid 125mg Tablet (Jan Aushadhi)",
            mrp: 57.85,
          },
        ],
        lowerPriceAlternatives: [],
      },
    },
    {
      temp_id: "demo_item_3",
      matched_medicine_id: ZEN_200_UUID,
      brand_name: "ZEN 200 Tablet",
      composition_display: "Carbamazepine (200mg)",
      composition_key: "carbamazepine (200mg)",
      dose: "1 tab HS",
      mrp: 16.77,
      is_nti: true,
      is_schedule_h: true,
      is_custom: false,
      isConfirmed: true,
      // Simulate tampered alternative on NTI item: must be stripped!
      selected_alternative_id: JAN_AUSHADHI_AMOX_UUID,
      alternativesGroup: {
        janAushadhiOptions: [
          { id: JAN_AUSHADHI_AMOX_UUID, brand_name: "Tampered Alt", mrp: 5 },
        ],
      },
    },
    {
      temp_id: "custom_row_99",
      matched_medicine_id: null,
      brand_name: "Custom Compound Syrup",
      composition_display: "Custom 10ml",
      composition_key: null,
      dose: "5ml SOS",
      mrp: 0,
      is_nti: false,
      is_schedule_h: false,
      is_custom: true,
      isConfirmed: true,
      selected_alternative_id: null,
      alternativesGroup: null,
    },
  ];

  const { confirmedMedicines, excludedCustomRows } = buildConfirmedMedicinesPayload(rows);

  assert.equal(excludedCustomRows.length, 1);
  assert.equal(excludedCustomRows[0].temp_id, "custom_row_99");
  assert.equal(confirmedMedicines.length, 2);

  // Prescribed UUID preserved + selected Jan Aushadhi alternative captured
  assert.equal(confirmedMedicines[0].medicine_id, AUGMENTIN_UUID);
  assert.equal(confirmedMedicines[0].selected_alternative_id, JAN_AUSHADHI_AMOX_UUID);
  assert.equal(confirmedMedicines[0].selected_alternative_mrp, 57.85);

  // NTI row strictly clears alternative
  assert.equal(confirmedMedicines[1].medicine_id, ZEN_200_UUID);
  assert.equal(confirmedMedicines[1].is_nti, true);
  assert.equal(confirmedMedicines[1].selected_alternative_id, null);
  assert.equal(confirmedMedicines[1].selected_alternative_mrp, null);
});

test("buildValidatedPlanRequest & confirmedMedicinesToPlanItems uphold P3 PlanRequest contract", () => {
  const confirmed: ConfirmedMedicine[] = [
    {
      medicine_id: AUGMENTIN_UUID,
      brand_name: "Augmentin 625 Duo Tablet",
      composition_key: "amoxycillin (500mg)|clavulanic acid (125mg)",
      strength: null,
      dosage: "1 tab BD",
      mrp: 223.42,
      selected_alternative_id: JAN_AUSHADHI_AMOX_UUID,
      selected_alternative_brand_name: "Jan Aushadhi Amoxycillin 625",
      selected_alternative_mrp: 57.85,
      is_nti: false,
      is_schedule_h: true,
    },
    {
      medicine_id: PAND_UUID,
      brand_name: "Pan-D Capsule PR",
      composition_key: "domperidone (30mg)|pantoprazole (40mg)",
      strength: null,
      dosage: "1 cap OD",
      mrp: 199,
      selected_alternative_id: null,
      is_nti: false,
      is_schedule_h: true,
    },
    {
      medicine_id: ZEN_200_UUID,
      brand_name: "ZEN 200 Tablet",
      composition_key: "carbamazepine (200mg)",
      strength: null,
      dosage: "1 tab HS",
      mrp: 16.77,
      selected_alternative_id: null,
      is_nti: true,
      is_schedule_h: true,
    },
  ];

  // Direct contracts.ts conversion check
  const directItems = confirmedMedicinesToPlanItems(confirmed);
  assert.equal(directItems[0].medicine_id, JAN_AUSHADHI_AMOX_UUID);
  assert.equal(directItems[0].allow_alternative, true);
  assert.equal(directItems[1].medicine_id, PAND_UUID);
  assert.equal(directItems[1].allow_alternative, false);
  assert.equal(directItems[2].medicine_id, ZEN_200_UUID);
  assert.equal(directItems[2].allow_alternative, false);
  assert.equal(directItems[2].is_nti, true);

  // Bhopal coordinates validation
  const planReq = buildValidatedPlanRequest(confirmed, 23.2599, 77.4126);
  assert.equal(planReq.user_lat, 23.2599);
  assert.equal(planReq.user_lng, 77.4126);
  assert.equal(planReq.items.length, 3);
  for (const item of planReq.items) {
    assert.equal(isValidMedicineUuid(item.medicine_id), true);
  }

  assert.throws(() => buildValidatedPlanRequest(confirmed, 95, 77.4126));
  assert.throws(() => buildValidatedPlanRequest(confirmed, 23.2599, 200));
});

test("End-to-end P2 pipeline: Demo Rx 2 -> Catalog Hydration -> Safety -> ConfirmedMedicine -> PlanRequest", () => {
  const miniCatalog: CandidateMedicine[] = [
    {
      id: ELTROXIN_50_UUID,
      brand_name: "Eltroxin 50 Tablet",
      composition_display: "Thyroxine (50mcg)",
      composition_key: "thyroxine (50mcg)",
      is_nti: true,
      is_schedule_h: true,
    },
    {
      id: SHELCAL_500_UUID,
      brand_name: "Shelcal 500",
      composition_display: "Calcium Carbonate 500mg + Vitamin D3 250IU",
      composition_key: "calcium carbonate (500mg)|vitamin d3 (250iu)",
      is_nti: false,
      is_schedule_h: false,
    },
  ];

  const demoRx2 = DEMO_PRESCRIPTIONS[1];
  const hydratedItems = resolveDemoItemsWithCatalog([...demoRx2.items], miniCatalog);
  const safetyReport = evaluatePrescriptionSafety(
    hydratedItems.map((i) => ({
      temp_id: i.temp_id,
      medicine_id: i.matched_medicine_id,
      brand_name: i.brand_name,
      composition_display: i.composition_display,
      composition_key: i.composition_key,
      is_nti: i.is_nti,
      is_schedule_h: i.is_schedule_h,
    })),
    { allergies: [], chronic_conditions: [], current_meds: [] }
  );

  const reviewRows: ReviewHandoffRowInput[] = hydratedItems.map((item, idx) => ({
    temp_id: item.temp_id,
    matched_medicine_id: item.matched_medicine_id,
    brand_name: item.brand_name,
    composition_display: item.composition_display,
    composition_key: item.composition_key,
    dose: item.dose,
    mrp: idx === 0 ? 92 : 135,
    is_nti: safetyReport.items[idx].is_nti,
    is_schedule_h: safetyReport.items[idx].is_schedule_h,
    is_custom: false,
    isConfirmed: true,
    selected_alternative_id: null,
    alternativesGroup: null,
  }));

  const { confirmedMedicines } = buildConfirmedMedicinesPayload(reviewRows);
  const planReq = buildValidatedPlanRequest(confirmedMedicines, 23.2599, 77.4126);

  assert.equal(planReq.items.length, 2);
  assert.equal(planReq.items[0].medicine_id, ELTROXIN_50_UUID);
  assert.equal(planReq.items[0].is_nti, true);
  assert.equal(planReq.items[0].allow_alternative, false);
  assert.equal(planReq.items[1].medicine_id, SHELCAL_500_UUID);
  assert.equal(planReq.items[1].is_nti, false);
});
