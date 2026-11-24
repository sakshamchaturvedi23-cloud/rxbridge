import { extractSaltNames } from "./normalize";

/**
 * Narrow Therapeutic Index (NTI) drug list.
 * Curated reference list of 25 critical outpatient/inpatient salts where small differences
 * in dose or blood concentration may lead to serious therapeutic failures or adverse reactions.
 * Under RxBridge clinical guardrails, NTI drugs strictly lock "allow_alternative" to false (Do-Not-Substitute).
 */
export const NTI_SALTS = [
  "levothyroxine",
  "warfarin",
  "phenytoin",
  "carbamazepine",
  "lithium",
  "digoxin",
  "tacrolimus",
  "theophylline",
  "sodium valproate",
  "valproic acid",
  "methotrexate",
  "cyclosporine",
  "amiodarone",
  "phenobarbital",
  "primidone",
  "ethosuximide",
  "clozapine",
  "sirolimus",
  "everolimus",
  "mycophenolate",
  "acenocoumarol",
  "quinidine",
  "procainamide",
  "flecainide",
  "aminophylline",
] as const;

/**
 * Escapes characters with special meaning in RegExp.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Checks if a given medicine composition contains any Narrow Therapeutic Index (NTI) salt.
 * Uses extractSaltNames for token isolation and word-boundary matching to prevent false positives.
 */
export function isNtiComposition(compositionDisplay: string): boolean {
  if (!compositionDisplay || typeof compositionDisplay !== "string") {
    return false;
  }

  const salts = extractSaltNames(compositionDisplay);
  if (salts.length === 0) {
    return false;
  }

  return salts.some((salt) =>
    NTI_SALTS.some((nti) => {
      // Handle standard clinical synonyms/variants (e.g., thyroxine for levothyroxine, ciclosporin for cyclosporine)
      if (nti === "levothyroxine") {
        return /\b(?:levo)?thyroxine\b/i.test(salt);
      }
      if (nti === "cyclosporine") {
        return /\b(?:cyclosporin[e]?|ciclosporin[e]?)\b/i.test(salt);
      }
      const regex = new RegExp(`\\b${escapeRegex(nti)}\\b`, "i");
      return regex.test(salt);
    })
  );
}

/**
 * Clean, deterministic keyword list of common Indian Schedule H and Schedule H1 outpatient drug classes.
 * Covers:
 * - Antibiotics & Antimicrobials
 * - Antihypertensives & Cardiac medications
 * - Antidiabetics (oral hypoglycemics & insulins)
 * - Statins & Lipid-lowering agents
 * - Proton Pump Inhibitors (PPIs)
 * - Corticosteroids
 * - Central Nervous System (CNS) & Psychotropics (sedatives, antidepressants, anticonvulsants)
 * - Prescription NSAIDs
 * - Other outpatient Schedule H classes
 *
 * NOTE: Common OTC substances (plain paracetamol, calcium, vitamin D3, ORS, cetirizine, basic antacids)
 * are excluded from this keyword list to strictly return false unless combined with a Schedule H drug.
 */
const SCHEDULE_H_KEYWORDS: readonly string[] = [
  // Antibiotics & Antimicrobials (Schedule H & H1)
  "amoxicillin",
  "ampicillin",
  "azithromycin",
  "cefixime",
  "cefuroxime",
  "cefpodoxime",
  "cephalexin",
  "ceftriaxone",
  "cefepime",
  "cefotaxime",
  "ciprofloxacin",
  "ofloxacin",
  "levofloxacin",
  "norfloxacin",
  "moxifloxacin",
  "doxycycline",
  "metronidazole",
  "tinidazole",
  "ornidazole",
  "clarithromycin",
  "erythromycin",
  "roxithromycin",
  "clindamycin",
  "trimethoprim",
  "sulfamethoxazole",
  "cotrimoxazole",
  "co-trimoxazole",
  "nitrofurantoin",
  "linezolid",
  "faropenem",
  "meropenem",
  "imipenem",
  "piperacillin",
  "tazobactam",
  "clavulanic",
  "gentamicin",
  "amikacin",
  "tobramycin",
  "vancomycin",
  "rifampicin",
  "isoniazid",
  "pyrazinamide",
  "ethambutol",

  // Antihypertensives & Cardiovascular Drugs
  "telmisartan",
  "amlodipine",
  "cilnidipine",
  "benidipine",
  "olmesartan",
  "losartan",
  "valsartan",
  "candesartan",
  "metoprolol",
  "atenolol",
  "bisoprolol",
  "nebivolol",
  "carvedilol",
  "propranolol",
  "labetalol",
  "ramipril",
  "enalapril",
  "lisinopril",
  "perindopril",
  "diltiazem",
  "verapamil",
  "clonidine",
  "prazosin",
  "spironolactone",
  "furosemide",
  "torsemide",
  "hydrochlorothiazide",
  "chlorthalidone",
  "indapamide",
  "nicorandil",
  "ivabradine",
  "nitroglycerin",
  "isosorbide",

  // Antidiabetics (Oral Hypoglycemics & Insulins)
  "metformin",
  "glimepiride",
  "gliclazide",
  "glipizide",
  "glibenclamide",
  "sitagliptin",
  "vildagliptin",
  "linagliptin",
  "teneligliptin",
  "saxagliptin",
  "dapagliflozin",
  "empagliflozin",
  "canagliflozin",
  "pioglitazone",
  "voglibose",
  "acarbose",
  "insulin",
  "repaglinide",

  // Statins & Lipid Lowering
  "atorvastatin",
  "rosuvastatin",
  "simvastatin",
  "pravastatin",
  "fenofibrate",
  "saroglitazar",

  // Proton Pump Inhibitors (PPIs) & GI Rx
  "pantoprazole",
  "omeprazole",
  "rabeprazole",
  "esomeprazole",
  "lansoprazole",
  "ilaprazole",
  "dexrabeprazole",

  // Corticosteroids
  "prednisolone",
  "methylprednisolone",
  "dexamethasone",
  "betamethasone",
  "hydrocortisone",
  "deflazacort",
  "budesonide",
  "fluticasone",
  "mometasone",
  "triamcinolone",
  "clobetasol",
  "beclomethasone",

  // CNS, Psychotropics & Neurological (Sedatives, Antidepressants, Anticonvulsants)
  "alprazolam",
  "clonazepam",
  "diazepam",
  "lorazepam",
  "zolpidem",
  "chlordiazepoxide",
  "etizolam",
  "escitalopram",
  "sertraline",
  "fluoxetine",
  "paroxetine",
  "fluvoxamine",
  "duloxetine",
  "venlafaxine",
  "desvenlafaxine",
  "amitriptyline",
  "nortriptyline",
  "mirtazapine",
  "pregabalin",
  "gabapentin",
  "levetiracetam",
  "lamotrigine",
  "topiramate",
  "baclofen",
  "tramadol",
  "tapentadol",
  "codeine",
  "haloperidol",
  "olanzapine",
  "quetiapine",
  "risperidone",
  "aripiprazole",

  // Prescription NSAIDs & Anti-inflammatories
  "aceclofenac",
  "diclofenac",
  "piroxicam",
  "meloxicam",
  "ketorolac",
  "indomethacin",
  "etoricoxib",
  "celecoxib",
  "nimesulide",
  "serratiopeptidase",
  "chymotrypsin",
  "mefenamic",

  // Respiratory Rx & Misc Schedule H
  "montelukast",
  "tamsulosin",
  "alfuzosin",
  "silodosin",
  "finasteride",
  "dutasteride",
  "sildenafil",
  "tadalafil",
  "hydroxychloroquine",
  "azathioprine",
  "leflunomide",
  "ondansetron",
  "domperidone",
  "itopride",
  "levosulpiride",
] as const;

/**
 * Determines whether a composition requires a valid prescription under Indian Schedule H / H1 regulations.
 *
 * Rules:
 * - All NTI drugs are prescription medicines (Schedule H/H1) and return true.
 * - Any composition matching Schedule H outpatient classes (antibiotics, antihypertensives,
 *   antidiabetics, statins, PPIs, steroids, CNS, Rx NSAIDs) returns true.
 * - Common OTC preparations (plain paracetamol, calcium, vitamin D3, ORS, cetirizine, basic antacids)
 *   strictly return false unless formulated with an active Schedule H ingredient.
 */
export function isScheduleHComposition(compositionDisplay: string): boolean {
  if (!compositionDisplay || typeof compositionDisplay !== "string") {
    return false;
  }

  // 1. All NTI drugs are strictly Schedule H / prescription medicines under Indian regulations
  if (isNtiComposition(compositionDisplay)) {
    return true;
  }

  const salts = extractSaltNames(compositionDisplay);
  if (salts.length === 0) {
    return false;
  }

  // 2. Check each extracted salt name against the Schedule H keyword list using word boundaries
  return salts.some((salt) =>
    SCHEDULE_H_KEYWORDS.some((keyword) => {
      const regex = new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i");
      return regex.test(salt);
    })
  );
}
