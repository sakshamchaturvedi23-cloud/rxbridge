/**
 * src/lib/clinical/review-handoff.ts
 *
 * Pure P2-to-P3 review confirmation & PlanRequest validation helpers.
 * Guarantees:
 * - Non-UUID temporary IDs (`temp_id`, custom drugs) never enter `ConfirmedMedicine.medicine_id` or `PlanRequest`.
 * - NTI drugs strictly lock `selected_alternative_id = null` and `allow_alternative = false`.
 * - Uses `confirmedMedicinesToPlanItems()` from `src/types/contracts.ts` without modifying shared contracts.
 *
 * Owner: P2 (AI Extraction, Clinical Rules & Data Owner)
 */

import {
  confirmedMedicinesToPlanItems,
  type ConfirmedMedicine,
  type PlanRequest,
  type SafetyFlag,
} from "@/types/contracts";
import { isNtiComposition, isScheduleHComposition } from "./nti-list";
import { CLINICAL_DISCLAIMERS } from "./safety-check";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidMedicineUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_REGEX.test(value.trim());
}

export interface ReviewHandoffRowInput {
  temp_id: string;
  matched_medicine_id: string | null;
  brand_name: string;
  composition_display: string | null;
  composition_key: string | null;
  dose: string | null;
  mrp: number;
  is_nti: boolean;
  is_schedule_h: boolean;
  is_custom: boolean;
  custom_strength?: string;
  isConfirmed: boolean;
  selected_alternative_id: string | null;
  alternativesGroup?: {
    janAushadhiOptions?: Array<{ id: string; brand_name: string; mrp: number }>;
    lowerPriceAlternatives?: Array<{ id: string; brand_name: string; mrp: number }>;
  } | null;
}

/**
 * Ensures NTI & Schedule H safety flags are present on a review row alongside any
 * allergy/condition/interaction flags from `/api/extract` or `/api/safety`.
 */
export function mergeRowClinicalSafetyFlags(
  existingFlags: SafetyFlag[] | undefined,
  opts: {
    brand_name: string;
    composition_display?: string | null;
    composition_key?: string | null;
    is_nti: boolean;
    is_schedule_h: boolean;
  }
): { isNti: boolean; isScheduleH: boolean; safetyFlags: SafetyFlag[] } {
  const compText = opts.composition_display || opts.composition_key || "";
  const isNti =
    Boolean(opts.is_nti) ||
    isNtiComposition(compText) ||
    isNtiComposition(opts.brand_name);
  const isScheduleH =
    Boolean(opts.is_schedule_h) || isNti || isScheduleHComposition(compText);

  const flags = [...(existingFlags ?? [])];

  if (isNti && !flags.some((f) => f.category === "nti_lock")) {
    flags.push({
      severity: "amber",
      category: "nti_lock",
      message:
        "Narrow Therapeutic Index medicine detected. Brand substitution is clinically locked.",
      disclaimer: CLINICAL_DISCLAIMERS.nti_lock,
    });
  }

  if (isScheduleH && !flags.some((f) => f.category === "schedule_h")) {
    flags.push({
      severity: "amber",
      category: "schedule_h",
      message:
        "Schedule H prescription drug. Valid prescription & pharmacist verification required.",
      disclaimer: CLINICAL_DISCLAIMERS.schedule_h,
    });
  }

  return { isNti, isScheduleH, safetyFlags: flags };
}

/**
 * Transforms confirmed review rows into strict `ConfirmedMedicine[]` for P3 `/api/plans`,
 * filtering out unlinked/custom rows that lack a valid catalog UUID.
 */
export function buildConfirmedMedicinesPayload(rows: ReviewHandoffRowInput[]): {
  confirmedMedicines: ConfirmedMedicine[];
  excludedCustomRows: ReviewHandoffRowInput[];
} {
  const confirmedMedicines: ConfirmedMedicine[] = [];
  const excludedCustomRows: ReviewHandoffRowInput[] = [];

  for (const r of rows) {
    if (!r.isConfirmed) continue;

    if (r.is_custom || !isValidMedicineUuid(r.matched_medicine_id)) {
      excludedCustomRows.push(r);
      continue;
    }

    const compText = r.composition_display || r.composition_key || "";
    const effectiveNti =
      Boolean(r.is_nti) || isNtiComposition(compText) || isNtiComposition(r.brand_name);
    const effectiveScheduleH =
      Boolean(r.is_schedule_h) || effectiveNti || isScheduleHComposition(compText);

    let safeAlternativeId: string | null = null;
    let altBrandName: string | null = null;
    let altMrp: number | null = null;

    if (
      !effectiveNti &&
      isValidMedicineUuid(r.selected_alternative_id) &&
      r.alternativesGroup
    ) {
      const allAlts = [
        ...(r.alternativesGroup.janAushadhiOptions || []),
        ...(r.alternativesGroup.lowerPriceAlternatives || []),
      ];
      const found = allAlts.find((a) => a.id === r.selected_alternative_id);
      if (found) {
        safeAlternativeId = found.id;
        altBrandName = found.brand_name;
        altMrp = found.mrp;
      }
    }

    confirmedMedicines.push({
      medicine_id: r.matched_medicine_id,
      brand_name: r.brand_name,
      composition_key: r.composition_key || r.composition_display || r.brand_name,
      strength: r.custom_strength || null,
      dosage: r.dose,
      mrp: Number(r.mrp) || 0,
      selected_alternative_id: safeAlternativeId,
      selected_alternative_brand_name: altBrandName,
      selected_alternative_mrp: altMrp,
      is_nti: effectiveNti,
      is_schedule_h: effectiveScheduleH,
    });
  }

  return { confirmedMedicines, excludedCustomRows };
}

/**
 * Builds a validated P3 `PlanRequest` from `ConfirmedMedicine[]` using `confirmedMedicinesToPlanItems()`.
 * Enforces UUID integrity and NTI `allow_alternative: false` invariants.
 */
export function buildValidatedPlanRequest(
  medicines: ConfirmedMedicine[],
  userLat: number,
  userLng: number
): PlanRequest {
  if (!Number.isFinite(userLat) || userLat < -90 || userLat > 90) {
    throw new Error(`Invalid user_lat coordinate: ${userLat}`);
  }
  if (!Number.isFinite(userLng) || userLng < -180 || userLng > 180) {
    throw new Error(`Invalid user_lng coordinate: ${userLng}`);
  }

  const sanitizedMedicines = medicines
    .filter((m) => isValidMedicineUuid(m.medicine_id))
    .map((m) => {
      const effectiveNti =
        Boolean(m.is_nti) ||
        isNtiComposition(m.composition_key) ||
        isNtiComposition(m.brand_name);

      return {
        ...m,
        is_nti: effectiveNti,
        selected_alternative_id:
          !effectiveNti && isValidMedicineUuid(m.selected_alternative_id)
            ? m.selected_alternative_id
            : null,
      };
    });

  return {
    user_lat: userLat,
    user_lng: userLng,
    items: confirmedMedicinesToPlanItems(sanitizedMedicines),
  };
}
