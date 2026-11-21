import type { ExtractedMedicineItem, ExtractResponse } from "@/types/contracts";
import { buildCompositionKey } from "./normalize";
import { isNtiComposition, isScheduleHComposition } from "./nti-list";

export interface DemoPrescription {
  key: string;
  patient_name: string;
  doctor_name: string;
  prescription_date: string;
  image_url: string;
  image_hash: string;
  match_patterns: string[];
  items: ExtractedMedicineItem[];
  trust_checks: {
    date_valid: boolean | null;
    patient_name_match: boolean | null;
    is_duplicate: boolean;
  };
}

/**
 * 5 Realistic Synthetic Demo Prescriptions.
 * Strictly fictional Indian patient names (never real patient data).
 * Enforces clinical safety: any NTI item strictly locks allow_alternative to false.
 */
export const DEMO_PRESCRIPTIONS: readonly DemoPrescription[] = [
  // --------------------------------------------------------------------------
  // Demo 1: Acute Respiratory Infection & Fever (Rahul Verma)
  // --------------------------------------------------------------------------
  {
    key: "demo-rx-1",
    patient_name: "Rahul Verma",
    doctor_name: "Dr. Arvind Sen, MD (General Medicine)",
    prescription_date: "2026-11-15",
    image_url: "/demo/demo-rx-1.jpg",
    image_hash: "hash-demo-rx-1",
    match_patterns: ["demo-rx-1", "demo_rx_1", "demorx1", "demo-1", "demo1", "rx-1", "rx1"],
    trust_checks: {
      date_valid: true,
      patient_name_match: true,
      is_duplicate: false,
    },
    items: [
      {
        temp_id: "demo-1-item-1",
        raw_text: "Tab. Augmentin 625 Duo 1 tab BD x 5 days",
        matched_medicine_id: null,
        brand_name: "Augmentin 625 Duo",
        composition_display: "Amoxicillin 500mg + Clavulanic Acid 125mg",
        composition_key: buildCompositionKey("Amoxicillin 500mg + Clavulanic Acid 125mg"),
        dose: "1 tablet twice daily after meals",
        duration: "5 days",
        confidence: "high",
        is_nti: isNtiComposition("Amoxicillin 500mg + Clavulanic Acid 125mg"),
        is_schedule_h: isScheduleHComposition("Amoxicillin 500mg + Clavulanic Acid 125mg"),
        allow_alternative: true,
        safety_flags: [],
      },
      {
        temp_id: "demo-1-item-2",
        raw_text: "Cap. Pan-D 1 cap OD AC x 5 days",
        matched_medicine_id: null,
        brand_name: "Pan-D",
        composition_display: "Pantoprazole 40mg + Domperidone 30mg",
        composition_key: buildCompositionKey("Pantoprazole 40mg + Domperidone 30mg"),
        dose: "1 capsule once daily before breakfast",
        duration: "5 days",
        confidence: "high",
        is_nti: isNtiComposition("Pantoprazole 40mg + Domperidone 30mg"),
        is_schedule_h: isScheduleHComposition("Pantoprazole 40mg + Domperidone 30mg"),
        allow_alternative: true,
        safety_flags: [],
      },
      {
        temp_id: "demo-1-item-3",
        raw_text: "Tab. Dolo 650 SOS for fever",
        matched_medicine_id: null,
        brand_name: "Dolo 650",
        composition_display: "Paracetamol 650mg",
        composition_key: buildCompositionKey("Paracetamol 650mg"),
        dose: "1 tablet SOS for body ache / fever (max 3/day)",
        duration: "5 days",
        confidence: "high",
        is_nti: isNtiComposition("Paracetamol 650mg"),
        is_schedule_h: isScheduleHComposition("Paracetamol 650mg"),
        allow_alternative: true,
        safety_flags: [],
      },
    ],
  },

  // --------------------------------------------------------------------------
  // Demo 2: Hypothyroidism & Bone Health — NTI Lock (Priya Nair)
  // --------------------------------------------------------------------------
  {
    key: "demo-rx-2",
    patient_name: "Priya Nair",
    doctor_name: "Dr. Meenakshi Sundaram, MD (Endocrinology)",
    prescription_date: "2026-11-18",
    image_url: "/demo/demo-rx-2.jpg",
    image_hash: "hash-demo-rx-2",
    match_patterns: ["demo-rx-2", "demo_rx_2", "demorx2", "demo-2", "demo2", "rx-2", "rx2"],
    trust_checks: {
      date_valid: true,
      patient_name_match: true,
      is_duplicate: false,
    },
    items: [
      {
        temp_id: "demo-2-item-1",
        raw_text: "Tab. Eltroxin 50 mcg 1 tab OD empty stomach",
        matched_medicine_id: null,
        brand_name: "Eltroxin 50mcg",
        composition_display: "Levothyroxine Sodium 50mcg",
        composition_key: buildCompositionKey("Levothyroxine Sodium 50mcg"),
        dose: "1 tablet once daily morning empty stomach",
        duration: "30 days",
        confidence: "high",
        is_nti: true,
        is_schedule_h: true,
        allow_alternative: false, // CLINICAL SAFETY: NTI strictly locks allow_alternative to false
        safety_flags: [
          {
            severity: "amber",
            category: "nti_lock",
            message: "Narrow Therapeutic Index medicine (Levothyroxine). Brand substitution is clinically locked.",
            disclaimer: "Narrow Therapeutic Index: do not substitute without doctor approval.",
          },
        ],
      },
      {
        temp_id: "demo-2-item-2",
        raw_text: "Tab. Shelcal 500 1 tab OD after lunch",
        matched_medicine_id: null,
        brand_name: "Shelcal 500",
        composition_display: "Calcium Carbonate 500mg + Vitamin D3 250IU",
        composition_key: buildCompositionKey("Calcium Carbonate 500mg + Vitamin D3 250IU"),
        dose: "1 tablet once daily after lunch",
        duration: "30 days",
        confidence: "high",
        is_nti: isNtiComposition("Calcium Carbonate 500mg + Vitamin D3 250IU"),
        is_schedule_h: isScheduleHComposition("Calcium Carbonate 500mg + Vitamin D3 250IU"),
        allow_alternative: true,
        safety_flags: [],
      },
    ],
  },

  // --------------------------------------------------------------------------
  // Demo 3: Hypertension & GI Prophylaxis (Amit Sharma)
  // --------------------------------------------------------------------------
  {
    key: "demo-rx-3",
    patient_name: "Amit Sharma",
    doctor_name: "Dr. Rajesh Bhardwaj, MD, DM (Cardiology)",
    prescription_date: "2026-11-10",
    image_url: "/demo/demo-rx-3.jpg",
    image_hash: "hash-demo-rx-3",
    match_patterns: ["demo-rx-3", "demo_rx_3", "demorx3", "demo-3", "demo3", "rx-3", "rx3"],
    trust_checks: {
      date_valid: true,
      patient_name_match: true,
      is_duplicate: false,
    },
    items: [
      {
        temp_id: "demo-3-item-1",
        raw_text: "Tab. Telma 40 1 tab OD morning",
        matched_medicine_id: null,
        brand_name: "Telma 40",
        composition_display: "Telmisartan 40mg",
        composition_key: buildCompositionKey("Telmisartan 40mg"),
        dose: "1 tablet once daily in the morning",
        duration: "30 days",
        confidence: "high",
        is_nti: isNtiComposition("Telmisartan 40mg"),
        is_schedule_h: isScheduleHComposition("Telmisartan 40mg"),
        allow_alternative: true,
        safety_flags: [],
      },
      {
        temp_id: "demo-3-item-2",
        raw_text: "Tab. Pan 40 1 tab OD before breakfast",
        matched_medicine_id: null,
        brand_name: "Pan 40",
        composition_display: "Pantoprazole 40mg",
        composition_key: buildCompositionKey("Pantoprazole 40mg"),
        dose: "1 tablet once daily before breakfast",
        duration: "15 days",
        confidence: "high",
        is_nti: isNtiComposition("Pantoprazole 40mg"),
        is_schedule_h: isScheduleHComposition("Pantoprazole 40mg"),
        allow_alternative: true,
        safety_flags: [],
      },
      {
        temp_id: "demo-3-item-3",
        raw_text: "Tab. EcoSprin 75 1 tab OD after dinner",
        matched_medicine_id: null,
        brand_name: "EcoSprin 75",
        composition_display: "Aspirin 75mg",
        composition_key: buildCompositionKey("Aspirin 75mg"),
        dose: "1 tablet once daily after dinner",
        duration: "30 days",
        confidence: "high",
        is_nti: isNtiComposition("Aspirin 75mg"),
        is_schedule_h: isScheduleHComposition("Aspirin 75mg"),
        allow_alternative: true,
        safety_flags: [],
      },
    ],
  },

  // --------------------------------------------------------------------------
  // Demo 4: Respiratory Infection & Allergy (Neha Kulkarni)
  // --------------------------------------------------------------------------
  {
    key: "demo-rx-4",
    patient_name: "Neha Kulkarni",
    doctor_name: "Dr. Suresh Patil, MBBS, DNB (Pulmonology)",
    prescription_date: "2026-11-19",
    image_url: "/demo/demo-rx-4.jpg",
    image_hash: "hash-demo-rx-4",
    match_patterns: ["demo-rx-4", "demo_rx_4", "demorx4", "demo-4", "demo4", "rx-4", "rx4"],
    trust_checks: {
      date_valid: true,
      patient_name_match: true,
      is_duplicate: false,
    },
    items: [
      {
        temp_id: "demo-4-item-1",
        raw_text: "Tab. Azithral 500 1 tab OD x 3 days",
        matched_medicine_id: null,
        brand_name: "Azithral 500",
        composition_display: "Azithromycin 500mg",
        composition_key: buildCompositionKey("Azithromycin 500mg"),
        dose: "1 tablet once daily 1 hour before food",
        duration: "3 days",
        confidence: "high",
        is_nti: isNtiComposition("Azithromycin 500mg"),
        is_schedule_h: isScheduleHComposition("Azithromycin 500mg"),
        allow_alternative: true,
        safety_flags: [],
      },
      {
        temp_id: "demo-4-item-2",
        raw_text: "Tab. Montair-LC 1 tab HS x 10 days",
        matched_medicine_id: null,
        brand_name: "Montair-LC",
        composition_display: "Montelukast 10mg + Levocetirizine 5mg",
        composition_key: buildCompositionKey("Montelukast 10mg + Levocetirizine 5mg"),
        dose: "1 tablet at bedtime (HS)",
        duration: "10 days",
        confidence: "high",
        is_nti: isNtiComposition("Montelukast 10mg + Levocetirizine 5mg"),
        is_schedule_h: isScheduleHComposition("Montelukast 10mg + Levocetirizine 5mg"),
        allow_alternative: true,
        safety_flags: [],
      },
      {
        temp_id: "demo-4-item-3",
        raw_text: "Tab. Calpol 650 SOS headache",
        matched_medicine_id: null,
        brand_name: "Calpol 650",
        composition_display: "Paracetamol 650mg",
        composition_key: buildCompositionKey("Paracetamol 650mg"),
        dose: "1 tablet as needed for headache",
        duration: "5 days",
        confidence: "amber", // Amber confidence to exercise patient review UI
        is_nti: isNtiComposition("Paracetamol 650mg"),
        is_schedule_h: isScheduleHComposition("Paracetamol 650mg"),
        allow_alternative: true,
        safety_flags: [],
      },
    ],
  },

  // --------------------------------------------------------------------------
  // Demo 5: Type-2 Diabetes, Dyslipidemia & Arthritis (Vikram Joshi)
  // --------------------------------------------------------------------------
  {
    key: "demo-rx-5",
    patient_name: "Vikram Joshi",
    doctor_name: "Dr. K. K. Aggarwal, MD (Internal Medicine)",
    prescription_date: "2026-11-12",
    image_url: "/demo/demo-rx-5.jpg",
    image_hash: "hash-demo-rx-5",
    match_patterns: ["demo-rx-5", "demo_rx_5", "demorx5", "demo-5", "demo5", "rx-5", "rx5"],
    trust_checks: {
      date_valid: true,
      patient_name_match: true,
      is_duplicate: false,
    },
    items: [
      {
        temp_id: "demo-5-item-1",
        raw_text: "Tab. Glycomet GP1 1 tab OD with breakfast",
        matched_medicine_id: null,
        brand_name: "Glycomet-GP 1",
        composition_display: "Glimepiride 1mg + Metformin 500mg",
        composition_key: buildCompositionKey("Glimepiride 1mg + Metformin 500mg"),
        dose: "1 tablet once daily with morning breakfast",
        duration: "30 days",
        confidence: "amber", // Amber confidence for handwriting simulation
        is_nti: isNtiComposition("Glimepiride 1mg + Metformin 500mg"),
        is_schedule_h: isScheduleHComposition("Glimepiride 1mg + Metformin 500mg"),
        allow_alternative: true,
        safety_flags: [],
      },
      {
        temp_id: "demo-5-item-2",
        raw_text: "Tab. Atorva 10 1 tab HS",
        matched_medicine_id: null,
        brand_name: "Atorva 10",
        composition_display: "Atorvastatin 10mg",
        composition_key: buildCompositionKey("Atorvastatin 10mg"),
        dose: "1 tablet at night",
        duration: "30 days",
        confidence: "high",
        is_nti: isNtiComposition("Atorvastatin 10mg"),
        is_schedule_h: isScheduleHComposition("Atorvastatin 10mg"),
        allow_alternative: true,
        safety_flags: [],
      },
      {
        temp_id: "demo-5-item-3",
        raw_text: "Tab. Combiflam 1 tab SOS joint pain",
        matched_medicine_id: null,
        brand_name: "Combiflam",
        composition_display: "Ibuprofen 400mg + Paracetamol 325mg",
        composition_key: buildCompositionKey("Ibuprofen 400mg + Paracetamol 325mg"),
        dose: "1 tablet SOS after meals for joint pain",
        duration: "5 days",
        confidence: "high",
        is_nti: isNtiComposition("Ibuprofen 400mg + Paracetamol 325mg"),
        is_schedule_h: isScheduleHComposition("Ibuprofen 400mg + Paracetamol 325mg"),
        allow_alternative: true,
        safety_flags: [],
      },
    ],
  },
] as const;

// Strict static assertion: no NTI item may ever have allow_alternative = true
for (const rx of DEMO_PRESCRIPTIONS) {
  for (const item of rx.items) {
    if (item.is_nti && item.allow_alternative) {
      throw new Error(
        `Clinical Safety Violation in Demo Cache (${rx.key}): NTI item ${item.brand_name} must have allow_alternative = false.`
      );
    }
  }
}

/**
 * Normalizes a file path, filename, or hash to a clean lowercase identifier for matching.
 */
function normalizeIdentifier(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.replace(/\.[^/.]+$/, "")
    .trim() || "";
}

/**
 * Finds a synthetic demo prescription from the offline cache by storage path or image hash.
 * Returns null if no matching demo prescription is found.
 *
 * Supported query formats:
 * - String path/hash: e.g. "demo-rx-1.jpg", "user-id/demo-rx-2.png", "hash-demo-rx-3", "rx-4"
 * - Object matching ExtractRequest: { storage_path?: string, image_hash?: string }
 */
export function findDemoPrescriptionCache(
  query?: string | { storage_path?: string | null; image_hash?: string | null } | null
): DemoPrescription | null {
  if (!query) return null;

  let pathValue: string | null = null;
  let hashValue: string | null = null;

  if (typeof query === "string") {
    pathValue = query;
    hashValue = query;
  } else {
    pathValue = query.storage_path || null;
    hashValue = query.image_hash || null;
  }

  const cleanPath = pathValue ? normalizeIdentifier(pathValue) : "";
  const cleanHash = hashValue ? hashValue.trim().toLowerCase() : "";

  for (const demo of DEMO_PRESCRIPTIONS) {
    // 1. Exact match on demo key
    if (cleanPath === demo.key || cleanHash === demo.key) {
      return demo;
    }

    // 2. Exact match on demo image hash
    if (cleanHash && cleanHash === demo.image_hash.toLowerCase()) {
      return demo;
    }
    if (cleanPath && cleanPath === demo.image_hash.toLowerCase()) {
      return demo;
    }

    // 3. Match against configured filename/slug patterns
    for (const pattern of demo.match_patterns) {
      const lowerPattern = pattern.toLowerCase();
      if (cleanPath === lowerPattern || cleanHash === lowerPattern) {
        return demo;
      }
      // Also match if pattern is a substring in filenames like "my-demo-rx-1.png"
      if (cleanPath && cleanPath.includes(lowerPattern)) {
        return demo;
      }
    }
  }

  return null;
}

/**
 * Checks whether a storage path or hash matches any demo prescription.
 */
export function isDemoPrescription(
  query?: string | { storage_path?: string | null; image_hash?: string | null } | null
): boolean {
  return findDemoPrescriptionCache(query) !== null;
}

/**
 * Maps a DemoPrescription directly into an ExtractResponse contract.
 */
export function toDemoExtractResponse(
  demo: DemoPrescription,
  prescriptionId?: string
): ExtractResponse {
  return {
    prescription_id: prescriptionId || `demo-${demo.key}`,
    from_demo_cache: true,
    items: [...demo.items],
    trust_checks: { ...demo.trust_checks },
  };
}
