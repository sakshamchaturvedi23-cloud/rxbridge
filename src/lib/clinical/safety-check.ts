/**
 * src/lib/clinical/safety-check.ts
 *
 * Deterministic Clinical Safety Evaluator for RxBridge (P2).
 * Evaluates prescribed/selected medicines against:
 * 1. NTI (Narrow Therapeutic Index) Do-Not-Substitute restrictions
 * 2. Schedule H / H1 prescription requirements
 * 3. Patient-reported allergies (direct salt match + clinical cross-reactivity classes)
 * 4. Patient-reported chronic conditions (curated contraindication/caution rules)
 * 5. Curated high-risk drug-drug interactions (vs patient current_meds and intra-prescription)
 *
 * IMPORTANT: Decision-support only. Curated interaction & condition checks cover high-risk
 * outpatient patterns and must never be represented as an exhaustive clinical database.
 *
 * Owner: P2 (AI Extraction, Clinical Rules & Data Owner)
 */

import type { SafetyFlag } from "@/types/contracts";
import { extractSaltNames, normalizeSaltSpelling } from "./normalize";
import {
  getMatchedNtiSalts,
  isNtiComposition,
  isScheduleHComposition,
} from "./nti-list";

export interface SafetyPatientProfile {
  allergies?: string[] | null;
  chronic_conditions?: string[] | null;
  current_meds?: string[] | null;
}

export interface SafetyMedicineInput {
  temp_id?: string;
  medicine_id?: string | null;
  brand_name: string;
  composition_display?: string | null;
  composition_key?: string | null;
  is_nti?: boolean;
  is_schedule_h?: boolean;
}

export interface ItemSafetyEvaluation {
  temp_id: string;
  medicine_id: string | null;
  brand_name: string;
  is_nti: boolean;
  is_schedule_h: boolean;
  allow_alternative: boolean;
  detected_salts: string[];
  safety_flags: SafetyFlag[];
}

export interface PrescriptionSafetyReport {
  items: ItemSafetyEvaluation[];
  all_flags: Array<SafetyFlag & { temp_id: string; brand_name: string }>;
  summary: {
    total_items: number;
    total_flags: number;
    red_count: number;
    amber_count: number;
    nti_count: number;
    schedule_h_count: number;
  };
  disclaimers: {
    decision_support: string;
    interaction_coverage: string;
    profile_source: string;
  };
}

export const CLINICAL_DISCLAIMERS = {
  decision_support:
    "Clinical decision-support only. Always verify medication safety with a licensed doctor or pharmacist.",
  interaction_coverage:
    "Curated interaction screening covers high-risk outpatient pairs only and is not an exhaustive drug-interaction database.",
  profile_source:
    "Patient-uploaded, unverified profile data (allergies, chronic conditions, and current medications).",
  nti_lock: "Narrow Therapeutic Index: do not substitute without doctor approval.",
  schedule_h:
    "Schedule H prescription drug: valid prescription and pharmacist verification required before dispensing.",
  allergy:
    "Allergy alert based on patient-reported profile. Confirm allergy history with a doctor or pharmacist before dispensing.",
  condition:
    "Condition-based precaution based on patient-reported profile. Consult your prescribing doctor before altering therapy.",
} as const;

function hasAnySalt(salts: string[], targets: readonly string[]): boolean {
  return salts.some((salt) =>
    targets.some((target) => {
      const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${escaped}\\b`, "i").test(salt);
    })
  );
}

function getMatchingSalts(salts: string[], targets: readonly string[]): string[] {
  const matched = new Set<string>();
  for (const salt of salts) {
    for (const target of targets) {
      const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`\\b${escaped}\\b`, "i").test(salt)) {
        matched.add(target);
      }
    }
  }
  return Array.from(matched);
}

// ---------------------------------------------------------------------------
// Curated Drug Classes
// ---------------------------------------------------------------------------
const PENICILLINS = [
  "amoxicillin",
  "ampicillin",
  "cloxacillin",
  "dicloxacillin",
  "piperacillin",
  "penicillin",
] as const;

const CEPHALOSPORINS = [
  "cefixime",
  "cefuroxime",
  "cefpodoxime",
  "cephalexin",
  "ceftriaxone",
  "cefepime",
  "cefotaxime",
] as const;

const SULFA_ANTIBIOTICS = [
  "sulfamethoxazole",
  "cotrimoxazole",
  "co trimoxazole",
  "sulfasalazine",
] as const;

const SULFA_CROSS_REACTIVE = [
  "celecoxib",
  "furosemide",
  "torsemide",
  "hydrochlorothiazide",
  "chlorthalidone",
  "glimepiride",
  "gliclazide",
  "glipizide",
  "glibenclamide",
] as const;

const NSAIDS = [
  "ibuprofen",
  "diclofenac",
  "aceclofenac",
  "naproxen",
  "piroxicam",
  "meloxicam",
  "ketorolac",
  "indomethacin",
  "etoricoxib",
  "celecoxib",
  "nimesulide",
  "mefenamic",
  "etodolac",
  "aspirin",
] as const;

const NON_ASPIRIN_NSAIDS = NSAIDS.filter((s) => s !== "aspirin");

const MACROLIDES = [
  "azithromycin",
  "erythromycin",
  "clarithromycin",
  "roxithromycin",
] as const;

const FLUOROQUINOLONES = [
  "ciprofloxacin",
  "ofloxacin",
  "levofloxacin",
  "norfloxacin",
  "moxifloxacin",
  "gatifloxacin",
] as const;

const STATINS = [
  "atorvastatin",
  "rosuvastatin",
  "simvastatin",
  "pravastatin",
] as const;

const BETA_BLOCKERS_NON_SELECTIVE = [
  "propranolol",
  "carvedilol",
  "labetalol",
] as const;

const BETA_BLOCKERS_SELECTIVE = [
  "metoprolol",
  "atenolol",
  "bisoprolol",
  "nebivolol",
] as const;

const ACE_INHIBITORS_ARBS = [
  "telmisartan",
  "losartan",
  "olmesartan",
  "valsartan",
  "candesartan",
  "irbesartan",
  "azilsartan",
  "ramipril",
  "enalapril",
  "lisinopril",
  "perindopril",
] as const;

const SYSTEMIC_STEROIDS = [
  "prednisolone",
  "methylprednisolone",
  "dexamethasone",
  "betamethasone",
  "hydrocortisone",
  "deflazacort",
] as const;

const ANTICOAGULANTS = ["warfarin", "acenocoumarol"] as const;

const ANTIPLATELETS = ["aspirin", "clopidogrel", "prasugrel", "ticagrelor"] as const;

const NITRATES = ["nitroglycerin", "isosorbide"] as const;

const PDE5_INHIBITORS = ["sildenafil", "tadalafil"] as const;

const POTASSIUM_SPARING = ["spironolactone", "eplerenone"] as const;

const THIAZIDE_DIURETICS = ["hydrochlorothiazide", "chlorthalidone", "indapamide", "metolazone"] as const;

const SSRI_SNRI_SEROTONERGIC = [
  "escitalopram",
  "sertraline",
  "fluoxetine",
  "paroxetine",
  "fluvoxamine",
  "duloxetine",
  "venlafaxine",
  "desvenlafaxine",
] as const;

const TRAMADOL_GROUP = ["tramadol", "tapentadol"] as const;

const QT_PROLONGING_AGENTS = [
  "amiodarone",
  "azithromycin",
  "ciprofloxacin",
  "levofloxacin",
  "moxifloxacin",
  "ondansetron",
  "domperidone",
  "haloperidol",
  "quetiapine",
] as const;

const ANTICHOLINERGIC_SEDATING = [
  "chlorpheniramine",
  "dicyclomine",
  "cyproheptadine",
  "amitriptyline",
  "nortriptyline",
] as const;

const PPIS = [
  "pantoprazole",
  "omeprazole",
  "rabeprazole",
  "esomeprazole",
  "lansoprazole",
  "ilaprazole",
  "dexrabeprazole",
] as const;

/**
 * Common Indian outpatient brand-prefix -> active salt mapping for resolving
 * patient-reported `current_meds` strings (which are often brand names like "Ecosprin 75").
 */
const COMMON_BRAND_TO_SALTS: Readonly<Record<string, string[]>> = {
  ecosprin: ["aspirin"],
  warf: ["warfarin"],
  acitrom: ["acenocoumarol"],
  dolo: ["paracetamol"],
  calpol: ["paracetamol"],
  crocin: ["paracetamol"],
  pacimol: ["paracetamol"],
  combiflam: ["ibuprofen", "paracetamol"],
  brufen: ["ibuprofen"],
  voveran: ["diclofenac"],
  zerodol: ["aceclofenac"],
  augmentin: ["amoxicillin", "clavulanic acid"],
  clavam: ["amoxicillin", "clavulanic acid"],
  moxikind: ["amoxicillin"],
  pan: ["pantoprazole"],
  pantocid: ["pantoprazole"],
  omez: ["omeprazole"],
  glycomet: ["metformin"],
  telma: ["telmisartan"],
  amlong: ["amlodipine"],
  stamlo: ["amlodipine"],
  atorva: ["atorvastatin"],
  storvas: ["atorvastatin"],
  rosuvas: ["rosuvastatin"],
  azithral: ["azithromycin"],
  azee: ["azithromycin"],
  eltroxin: ["levothyroxine"],
  thyronorm: ["levothyroxine"],
  eptoin: ["phenytoin"],
  tegretol: ["carbamazepine"],
  lanoxin: ["digoxin"],
  lasix: ["furosemide"],
  aldactone: ["spironolactone"],
  clopitab: ["clopidogrel"],
  plavix: ["clopidogrel"],
  sorbitrate: ["isosorbide"],
  monotrate: ["isosorbide"],
  viagra: ["sildenafil"],
  cialis: ["tadalafil"],
  omnacortil: ["prednisolone"],
  wysolone: ["prednisolone"],
};

/**
 * Resolves a medicine item's salt names from its composition_display, composition_key, or brand_name.
 */
export function resolveSaltsForItem(item: SafetyMedicineInput): string[] {
  const fromDisplay = item.composition_display
    ? extractSaltNames(item.composition_display)
    : [];
  if (fromDisplay.length > 0) {
    return Array.from(new Set(fromDisplay));
  }

  const fromKey = item.composition_key ? extractSaltNames(item.composition_key) : [];
  if (fromKey.length > 0) {
    return Array.from(new Set(fromKey));
  }

  return resolveTextToSalts(item.brand_name);
}

/**
 * Extracts normalized salts from free-form medication strings (e.g. profile.current_meds).
 */
export function resolveTextToSalts(rawMed: string): string[] {
  if (!rawMed || typeof rawMed !== "string") return [];

  const salts = new Set<string>();
  const parts = rawMed.split(/[+|]/);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    let matchedBrand = false;
    const lowerPart = trimmed.toLowerCase();
    for (const [brandPrefix, mappedSalts] of Object.entries(COMMON_BRAND_TO_SALTS)) {
      if (new RegExp(`\\b${brandPrefix}\\b`, "i").test(lowerPart)) {
        matchedBrand = true;
        for (const s of mappedSalts) {
          salts.add(normalizeSaltSpelling(s));
        }
      }
    }

    if (!matchedBrand) {
      for (const token of extractSaltNames(trimmed)) {
        salts.add(token);
      }
    }
  }

  return Array.from(salts);
}

// ---------------------------------------------------------------------------
// Allergy Rules
// ---------------------------------------------------------------------------
interface AllergyRule {
  triggers: RegExp;
  directSalts?: readonly string[];
  crossReactiveSalts?: readonly string[];
  label: string;
}

const ALLERGY_RULES: readonly AllergyRule[] = [
  {
    triggers: /\b(penicillin|beta[\s-]?lactam|amox[iy]cillin|ampicillin|augmentin)\b/i,
    directSalts: PENICILLINS,
    crossReactiveSalts: CEPHALOSPORINS,
    label: "Penicillin / Beta-lactam",
  },
  {
    triggers: /\b(sulfa|sulphonamide|sulfonamide|cotrimoxazole|co-trimoxazole|septran)\b/i,
    directSalts: SULFA_ANTIBIOTICS,
    crossReactiveSalts: SULFA_CROSS_REACTIVE,
    label: "Sulfonamide (Sulfa)",
  },
  {
    triggers: /\b(nsaid|aspirin|ibuprofen|diclofenac|aceclofenac|naproxen|painkiller)\b/i,
    directSalts: NSAIDS,
    label: "NSAID / Aspirin",
  },
  {
    triggers: /\b(macrolide|azithromycin|erythromycin|clarithromycin)\b/i,
    directSalts: MACROLIDES,
    label: "Macrolide antibiotic",
  },
  {
    triggers: /\b(fluoroquinolone|quinolone|ciprofloxacin|ofloxacin|levofloxacin)\b/i,
    directSalts: FLUOROQUINOLONES,
    label: "Fluoroquinolone",
  },
  {
    triggers: /\b(paracetamol|acetaminophen|crocin|dolo)\b/i,
    directSalts: ["paracetamol"],
    label: "Paracetamol",
  },
  {
    triggers: /\b(statin|atorvastatin|rosuvastatin|simvastatin)\b/i,
    directSalts: STATINS,
    label: "Statin",
  },
];

function checkAllergies(
  salts: string[],
  brandName: string,
  allergies: string[]
): SafetyFlag[] {
  const flags: SafetyFlag[] = [];
  if (allergies.length === 0) return flags;

  const lowerBrand = brandName.toLowerCase();

  for (const rawAllergy of allergies) {
    const allergy = rawAllergy?.trim();
    if (!allergy) continue;

    const normalizedAllergy = normalizeSaltSpelling(allergy);
    let matchedRule = false;

    for (const rule of ALLERGY_RULES) {
      if (!rule.triggers.test(allergy) && !rule.triggers.test(normalizedAllergy)) {
        continue;
      }

      if (rule.directSalts && hasAnySalt(salts, rule.directSalts)) {
        matchedRule = true;
        const hits = getMatchingSalts(salts, rule.directSalts);
        flags.push({
          severity: "red",
          category: "allergy",
          message: `Allergy contraindication (${allergy}): contains ${hits.join(", ")} (${rule.label} class).`,
          disclaimer: CLINICAL_DISCLAIMERS.allergy,
        });
      } else if (rule.crossReactiveSalts && hasAnySalt(salts, rule.crossReactiveSalts)) {
        matchedRule = true;
        const hits = getMatchingSalts(salts, rule.crossReactiveSalts);
        flags.push({
          severity: "amber",
          category: "allergy",
          message: `Potential ${rule.label} cross-reactivity caution (${allergy}): contains ${hits.join(", ")}.`,
          disclaimer: CLINICAL_DISCLAIMERS.allergy,
        });
      }
    }

    // Direct salt or brand token match fallback for unlisted allergens (e.g. "metformin", "iodine")
    if (!matchedRule && normalizedAllergy.length >= 3) {
      const escaped = normalizedAllergy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const tokenRegex = new RegExp(`\\b${escaped}\\b`, "i");
      if (salts.some((s) => tokenRegex.test(s)) || tokenRegex.test(lowerBrand)) {
        flags.push({
          severity: "red",
          category: "allergy",
          message: `Direct allergy match for "${allergy}" in ${brandName}.`,
          disclaimer: CLINICAL_DISCLAIMERS.allergy,
        });
      }
    }
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Chronic Condition Rules
// ---------------------------------------------------------------------------
interface ConditionRule {
  triggers: RegExp;
  salts: readonly string[];
  severity: "red" | "amber";
  message: (condition: string, matchedSalts: string[]) => string;
}

const CONDITION_RULES: readonly ConditionRule[] = [
  {
    triggers: /\b(asthma|copd|bronchospasm|wheez|reactive\s+airway)\b/i,
    salts: BETA_BLOCKERS_NON_SELECTIVE,
    severity: "red",
    message: (cond, hits) =>
      `Condition warning (${cond}): non-selective beta-blocker (${hits.join(", ")}) may trigger bronchospasm.`,
  },
  {
    triggers: /\b(asthma|copd|bronchospasm|reactive\s+airway)\b/i,
    salts: BETA_BLOCKERS_SELECTIVE,
    severity: "amber",
    message: (cond, hits) =>
      `Condition caution (${cond}): beta-blocker (${hits.join(", ")}) requires respiratory monitoring.`,
  },
  {
    triggers: /\b(asthma)\b/i,
    salts: NSAIDS,
    severity: "amber",
    message: (cond, hits) =>
      `Condition caution (${cond}): NSAID/aspirin (${hits.join(", ")}) can worsen aspirin-exacerbated respiratory disease in sensitive patients.`,
  },
  {
    triggers: /\b(peptic\s+ulcer|gastric\s+ulcer|gi\s+bleed|gastrointestinal\s+bleed|ulcer|gastritis)\b/i,
    salts: NSAIDS,
    severity: "red",
    message: (cond, hits) =>
      `Condition contraindication (${cond}): NSAID/aspirin (${hits.join(", ")}) increases gastrointestinal bleeding and ulcer risk.`,
  },
  {
    triggers: /\b(peptic\s+ulcer|gastric\s+ulcer|gi\s+bleed|ulcer)\b/i,
    salts: SYSTEMIC_STEROIDS,
    severity: "amber",
    message: (cond, hits) =>
      `Condition caution (${cond}): systemic corticosteroid (${hits.join(", ")}) may aggravate gastric mucosal injury.`,
  },
  {
    triggers: /\b(ckd|chronic\s+kidney|kidney\s+disease|renal\s+impairment|renal\s+failure)\b/i,
    salts: NON_ASPIRIN_NSAIDS,
    severity: "red",
    message: (cond, hits) =>
      `Condition contraindication (${cond}): NSAID (${hits.join(", ")}) carries high risk of acute kidney injury.`,
  },
  {
    triggers: /\b(ckd|chronic\s+kidney|kidney\s+disease|renal\s+impairment|renal\s+failure)\b/i,
    salts: ["metformin"],
    severity: "amber",
    message: (cond) =>
      `Condition caution (${cond}): metformin dosing/eligibility depends on current eGFR (lactic acidosis risk).`,
  },
  {
    triggers: /\b(ckd|chronic\s+kidney|kidney\s+disease|renal\s+impairment|renal\s+failure)\b/i,
    salts: POTASSIUM_SPARING,
    severity: "amber",
    message: (cond, hits) =>
      `Condition caution (${cond}): ${hits.join(", ")} increases hyperkalemia risk.`,
  },
  {
    triggers: /\b(liver|hepatic|cirrhosis|hepatitis)\b/i,
    salts: ["methotrexate", "nimesulide"],
    severity: "red",
    message: (cond, hits) =>
      `Condition contraindication (${cond}): ${hits.join(", ")} carries significant hepatotoxicity risk.`,
  },
  {
    triggers: /\b(liver|hepatic|cirrhosis|hepatitis)\b/i,
    salts: ["paracetamol", ...STATINS],
    severity: "amber",
    message: (cond, hits) =>
      `Condition caution (${cond}): ${hits.join(", ")} requires hepatic dose adjustment or monitoring.`,
  },
  {
    triggers: /\b(pregnan\w*)\b/i,
    salts: [
      ...ACE_INHIBITORS_ARBS,
      ...STATINS,
      ...ANTICOAGULANTS,
      ...FLUOROQUINOLONES,
      "methotrexate",
      "sodium valproate",
      "valproic acid",
      "isotretinoin",
      "doxycycline",
    ],
    severity: "red",
    message: (cond, hits) =>
      `Pregnancy warning (${cond}): ${hits.join(", ")} is contraindicated or high-risk during pregnancy.`,
  },
  {
    triggers: /\b(diabetes|diabetic)\b/i,
    salts: SYSTEMIC_STEROIDS,
    severity: "amber",
    message: (cond, hits) =>
      `Condition caution (${cond}): corticosteroid (${hits.join(", ")}) may elevate blood glucose levels.`,
  },
  {
    triggers: /\b(heart\s+failure|chf|ccf|cardiac\s+failure)\b/i,
    salts: [...NON_ASPIRIN_NSAIDS, "pioglitazone"],
    severity: "red",
    message: (cond, hits) =>
      `Condition warning (${cond}): ${hits.join(", ")} may worsen fluid retention and heart failure.`,
  },
  {
    triggers: /\b(glaucoma|bph|benign\s+prostatic|urinary\s+retention)\b/i,
    salts: ANTICHOLINERGIC_SEDATING,
    severity: "amber",
    message: (cond, hits) =>
      `Condition caution (${cond}): anticholinergic agent (${hits.join(", ")}) may worsen symptoms.`,
  },
];

function checkConditions(salts: string[], conditions: string[]): SafetyFlag[] {
  const flags: SafetyFlag[] = [];
  if (conditions.length === 0 || salts.length === 0) return flags;

  for (const rawCond of conditions) {
    const cond = rawCond?.trim();
    if (!cond) continue;

    for (const rule of CONDITION_RULES) {
      if (!rule.triggers.test(cond)) continue;
      if (!hasAnySalt(salts, rule.salts)) continue;

      const hits = getMatchingSalts(salts, rule.salts);
      flags.push({
        severity: rule.severity,
        category: "condition",
        message: rule.message(cond, hits),
        disclaimer: CLINICAL_DISCLAIMERS.condition,
      });
    }
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Curated Drug-Drug Interaction Rules
// ---------------------------------------------------------------------------
interface InteractionRule {
  groupA: readonly string[];
  groupB: readonly string[];
  severity: "red" | "amber";
  message: (saltsA: string[], saltsB: string[], sourceLabel: string) => string;
}

const INTERACTION_RULES: readonly InteractionRule[] = [
  {
    groupA: ANTICOAGULANTS,
    groupB: [...NSAIDS, "clopidogrel", "prasugrel", "ticagrelor"],
    severity: "red",
    message: (a, b, src) =>
      `Major bleeding interaction: ${a.join(", ")} combined with ${b.join(", ")} (${src}) significantly elevates bleeding risk.`,
  },
  {
    groupA: ANTICOAGULANTS,
    groupB: ["amiodarone", "fluconazole", "metronidazole", "ciprofloxacin", "azithromycin"],
    severity: "amber",
    message: (a, b, src) =>
      `Anticoagulant interaction: ${a.join(", ")} with ${b.join(", ")} (${src}) may elevate INR/bleeding risk.`,
  },
  {
    groupA: NITRATES,
    groupB: PDE5_INHIBITORS,
    severity: "red",
    message: (a, b, src) =>
      `Contraindicated interaction: ${a.join(", ")} with ${b.join(", ")} (${src}) can cause life-threatening hypotension.`,
  },
  {
    groupA: ["lithium"],
    groupB: [...NON_ASPIRIN_NSAIDS, ...THIAZIDE_DIURETICS, ...ACE_INHIBITORS_ARBS],
    severity: "red",
    message: (a, b, src) =>
      `NTI toxicity risk: ${a.join(", ")} with ${b.join(", ")} (${src}) can elevate serum lithium to toxic levels.`,
  },
  {
    groupA: ["methotrexate"],
    groupB: [...NSAIDS, ...SULFA_ANTIBIOTICS, "trimethoprim"],
    severity: "red",
    message: (a, b, src) =>
      `NTI toxicity risk: ${a.join(", ")} with ${b.join(", ")} (${src}) increases methotrexate toxicity.`,
  },
  {
    groupA: ANTIPLATELETS,
    groupB: NON_ASPIRIN_NSAIDS,
    severity: "amber",
    message: (a, b, src) =>
      `Bleeding caution: ${a.join(", ")} with NSAID ${b.join(", ")} (${src}) increases GI bleeding risk.`,
  },
  {
    groupA: ACE_INHIBITORS_ARBS,
    groupB: POTASSIUM_SPARING,
    severity: "amber",
    message: (a, b, src) =>
      `Hyperkalemia caution: ${a.join(", ")} with ${b.join(", ")} (${src}) may raise serum potassium.`,
  },
  {
    groupA: ACE_INHIBITORS_ARBS,
    groupB: NON_ASPIRIN_NSAIDS,
    severity: "amber",
    message: (a, b, src) =>
      `Renal/BP caution: ${a.join(", ")} with NSAID ${b.join(", ")} (${src}) may reduce antihypertensive effect and stress kidneys.`,
  },
  {
    groupA: TRAMADOL_GROUP,
    groupB: SSRI_SNRI_SEROTONERGIC,
    severity: "amber",
    message: (a, b, src) =>
      `Serotonergic interaction: ${a.join(", ")} with ${b.join(", ")} (${src}) increases serotonin syndrome and seizure risk.`,
  },
  {
    groupA: ["amiodarone", "haloperidol"],
    groupB: QT_PROLONGING_AGENTS,
    severity: "amber",
    message: (a, b, src) =>
      `QT prolongation caution: ${a.join(", ")} with ${b.join(", ")} (${src}) may increase arrhythmia risk.`,
  },
];

function checkPairwiseInteractions(
  itemSalts: string[],
  otherSalts: string[],
  sourceLabel: string
): SafetyFlag[] {
  const flags: SafetyFlag[] = [];
  if (itemSalts.length === 0 || otherSalts.length === 0) return flags;

  for (const rule of INTERACTION_RULES) {
    const aInItem = getMatchingSalts(itemSalts, rule.groupA);
    const bInOther = getMatchingSalts(otherSalts, rule.groupB);
    if (aInItem.length > 0 && bInOther.length > 0) {
      // Avoid trivial self-match when checking symmetric groups like QT_PROLONGING_AGENTS
      const sameOnly =
        aInItem.length === 1 && bInOther.length === 1 && aInItem[0] === bInOther[0];
      if (!sameOnly) {
        flags.push({
          severity: rule.severity,
          category: "interaction",
          message: rule.message(aInItem, bInOther, sourceLabel),
          disclaimer: CLINICAL_DISCLAIMERS.interaction_coverage,
        });
      }
    }

    const bInItem = getMatchingSalts(itemSalts, rule.groupB);
    const aInOther = getMatchingSalts(otherSalts, rule.groupA);
    if (bInItem.length > 0 && aInOther.length > 0) {
      const sameOnly =
        bInItem.length === 1 && aInOther.length === 1 && bInItem[0] === aInOther[0];
      if (!sameOnly) {
        flags.push({
          severity: rule.severity,
          category: "interaction",
          message: rule.message(aInOther, bInItem, sourceLabel),
          disclaimer: CLINICAL_DISCLAIMERS.interaction_coverage,
        });
      }
    }
  }

  // Duplicate therapeutic class / ingredient checks
  const sharedSalts = itemSalts.filter((s) => otherSalts.includes(s));
  if (sharedSalts.length > 0) {
    flags.push({
      severity: "amber",
      category: "interaction",
      message: `Duplicate ingredient detected: "${sharedSalts.join(", ")}" also appears in ${sourceLabel}.`,
      disclaimer: CLINICAL_DISCLAIMERS.interaction_coverage,
    });
  } else {
    // Duplicate NSAID or duplicate PPI check (different salts in same class)
    const itemNsaids = getMatchingSalts(itemSalts, NON_ASPIRIN_NSAIDS);
    const otherNsaids = getMatchingSalts(otherSalts, NON_ASPIRIN_NSAIDS);
    if (itemNsaids.length > 0 && otherNsaids.length > 0) {
      flags.push({
        severity: "amber",
        category: "interaction",
        message: `Duplicate NSAID therapy: ${itemNsaids.join(", ")} alongside ${otherNsaids.join(", ")} (${sourceLabel}) increases GI and renal risk.`,
        disclaimer: CLINICAL_DISCLAIMERS.interaction_coverage,
      });
    }

    const itemPpis = getMatchingSalts(itemSalts, PPIS);
    const otherPpis = getMatchingSalts(otherSalts, PPIS);
    if (itemPpis.length > 0 && otherPpis.length > 0) {
      flags.push({
        severity: "amber",
        category: "interaction",
        message: `Duplicate PPI therapy: ${itemPpis.join(", ")} alongside ${otherPpis.join(", ")} (${sourceLabel}).`,
        disclaimer: CLINICAL_DISCLAIMERS.interaction_coverage,
      });
    }
  }

  return flags;
}

function deduplicateFlags(flags: SafetyFlag[]): SafetyFlag[] {
  const seen = new Set<string>();
  const out: SafetyFlag[] = [];
  for (const flag of flags) {
    const key = `${flag.category}:${flag.severity}:${flag.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(flag);
    }
  }
  // Red flags first, then amber
  return out.sort((a, b) => {
    if (a.severity === b.severity) return 0;
    return a.severity === "red" ? -1 : 1;
  });
}

/**
 * Evaluates a batch of prescription/confirmed medicines against a patient's profile
 * (allergies, chronic_conditions, current_meds) and intra-prescription interactions.
 */
export function evaluatePrescriptionSafety(
  items: SafetyMedicineInput[],
  profile: SafetyPatientProfile = {}
): PrescriptionSafetyReport {
  const allergies = (profile.allergies ?? []).filter(Boolean);
  const conditions = (profile.chronic_conditions ?? []).filter(Boolean);
  const currentMeds = (profile.current_meds ?? []).filter(Boolean);

  const resolvedCurrentMeds = currentMeds.map((med) => ({
    label: `current medication "${med}"`,
    salts: resolveTextToSalts(med),
  }));

  const resolvedItems = items.map((item, idx) => {
    const tempId = item.temp_id || `item-${idx + 1}`;
    const salts = resolveSaltsForItem(item);
    const compText = item.composition_display || item.composition_key || "";
    const ntiSalts = [
      ...getMatchedNtiSalts(compText),
      ...getMatchedNtiSalts(item.brand_name),
    ];
    const isNti = Boolean(item.is_nti) || ntiSalts.length > 0 || isNtiComposition(compText);
    const isScheduleH =
      Boolean(item.is_schedule_h) || isNti || isScheduleHComposition(compText);

    return {
      temp_id: tempId,
      medicine_id: item.medicine_id ?? null,
      brand_name: item.brand_name,
      salts,
      ntiSalts: Array.from(new Set(ntiSalts)),
      isNti,
      isScheduleH,
    };
  });

  const evaluations: ItemSafetyEvaluation[] = [];
  const allFlags: Array<SafetyFlag & { temp_id: string; brand_name: string }> = [];

  for (let i = 0; i < resolvedItems.length; i++) {
    const current = resolvedItems[i];
    const flags: SafetyFlag[] = [];

    // 1. NTI Do-Not-Substitute Lock
    if (current.isNti) {
      const saltDetail =
        current.ntiSalts.length > 0 ? ` (${current.ntiSalts.join(", ")})` : "";
      flags.push({
        severity: "amber",
        category: "nti_lock",
        message: `Narrow Therapeutic Index medicine${saltDetail} detected. Brand substitution is clinically locked.`,
        disclaimer: CLINICAL_DISCLAIMERS.nti_lock,
      });
    }

    // 2. Schedule H Prescription Requirement
    if (current.isScheduleH) {
      flags.push({
        severity: "amber",
        category: "schedule_h",
        message: "Schedule H prescription drug. Valid prescription & pharmacist verification required.",
        disclaimer: CLINICAL_DISCLAIMERS.schedule_h,
      });
    }

    // 3. Patient Allergies & Cross-Reactivity
    flags.push(...checkAllergies(current.salts, current.brand_name, allergies));

    // 4. Chronic Conditions Contraindications / Cautions
    flags.push(...checkConditions(current.salts, conditions));

    // 5a. Interactions against patient's current_meds
    for (const cm of resolvedCurrentMeds) {
      flags.push(...checkPairwiseInteractions(current.salts, cm.salts, cm.label));
    }

    // 5b. Intra-prescription interactions against other items in the same order
    for (let j = 0; j < resolvedItems.length; j++) {
      if (i === j) continue;
      const other = resolvedItems[j];
      flags.push(
        ...checkPairwiseInteractions(
          current.salts,
          other.salts,
          `prescribed item "${other.brand_name}"`
        )
      );
    }

    const uniqueFlags = deduplicateFlags(flags);

    evaluations.push({
      temp_id: current.temp_id,
      medicine_id: current.medicine_id,
      brand_name: current.brand_name,
      is_nti: current.isNti,
      is_schedule_h: current.isScheduleH,
      allow_alternative: current.isNti ? false : true,
      detected_salts: current.salts,
      safety_flags: uniqueFlags,
    });

    for (const f of uniqueFlags) {
      allFlags.push({
        ...f,
        temp_id: current.temp_id,
        brand_name: current.brand_name,
      });
    }
  }

  const redCount = allFlags.filter((f) => f.severity === "red").length;
  const amberCount = allFlags.filter((f) => f.severity === "amber").length;
  const ntiCount = evaluations.filter((e) => e.is_nti).length;
  const scheduleHCount = evaluations.filter((e) => e.is_schedule_h).length;

  return {
    items: evaluations,
    all_flags: allFlags,
    summary: {
      total_items: evaluations.length,
      total_flags: allFlags.length,
      red_count: redCount,
      amber_count: amberCount,
      nti_count: ntiCount,
      schedule_h_count: scheduleHCount,
    },
    disclaimers: {
      decision_support: CLINICAL_DISCLAIMERS.decision_support,
      interaction_coverage: CLINICAL_DISCLAIMERS.interaction_coverage,
      profile_source: CLINICAL_DISCLAIMERS.profile_source,
    },
  };
}
