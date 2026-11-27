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
 * Returns the matched canonical NTI salt names for a given composition string (empty if non-NTI).
 */
export function getMatchedNtiSalts(compositionDisplay: string): string[] {
  if (!compositionDisplay || typeof compositionDisplay !== "string") {
    return [];
  }

  const salts = extractSaltNames(compositionDisplay);
  if (salts.length === 0) {
    return [];
  }

  const matched = new Set<string>();
  for (const salt of salts) {
    for (const nti of NTI_SALTS) {
      if (nti === "levothyroxine") {
        if (/\b(?:levo)?thyroxine\b/i.test(salt)) {
          matched.add(nti);
        }
      } else if (nti === "cyclosporine") {
        if (/\b(?:cyclosporin[e]?|ciclosporin[e]?)\b/i.test(salt)) {
          matched.add(nti);
        }
      } else if (nti === "phenobarbital") {
        if (/\bphenobarbit(?:al|one)\b/i.test(salt)) {
          matched.add(nti);
        }
      } else if (nti === "acenocoumarol") {
        if (/\b(?:acenocoumarol|nicoumalone)\b/i.test(salt)) {
          matched.add(nti);
        }
      } else if (nti === "sodium valproate" || nti === "valproic acid") {
        if (/\b(?:sodium\s+valproate|valproic\s+acid|divalproex)\b/i.test(salt)) {
          matched.add(nti);
        }
      } else {
        const regex = new RegExp(`\\b${escapeRegex(nti)}\\b`, "i");
        if (regex.test(salt)) {
          matched.add(nti);
        }
      }
    }
  }

  return Array.from(matched);
}

/**
 * Checks if a given medicine composition contains any Narrow Therapeutic Index (NTI) salt.
 * Uses extractSaltNames for token isolation and word-boundary matching to prevent false positives.
 */
export function isNtiComposition(compositionDisplay: string): boolean {
  return getMatchedNtiSalts(compositionDisplay).length > 0;
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
  "cloxacillin",
  "dicloxacillin",
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
  "gatifloxacin",
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
  "itraconazole",
  "fluconazole",
  "voriconazole",
  "terbinafine",
  "albendazole",
  "ivermectin",

  // Antihypertensives, Antiplatelets & Cardiovascular Drugs
  "telmisartan",
  "amlodipine",
  "cilnidipine",
  "benidipine",
  "nifedipine",
  "felodipine",
  "olmesartan",
  "losartan",
  "valsartan",
  "candesartan",
  "irbesartan",
  "azilsartan",
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
  "moxonidine",
  "methyldopa",
  "hydralazine",
  "prazosin",
  "spironolactone",
  "eplerenone",
  "furosemide",
  "torsemide",
  "hydrochlorothiazide",
  "chlorthalidone",
  "indapamide",
  "metolazone",
  "nicorandil",
  "ivabradine",
  "ranolazine",
  "nitroglycerin",
  "isosorbide",
  "clopidogrel",
  "prasugrel",
  "ticagrelor",
  "warfarin",

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
  "dicyclomine",

  // Corticosteroids & Hormones
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
  "progesterone",

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
  "trazodone",
  "pregabalin",
  "gabapentin",
  "levetiracetam",
  "oxcarbazepine",
  "lamotrigine",
  "topiramate",
  "piracetam",
  "baclofen",
  "tramadol",
  "tapentadol",
  "codeine",
  "haloperidol",
  "olanzapine",
  "quetiapine",
  "risperidone",
  "aripiprazole",
  "donepezil",
  "memantine",
  "amantadine",
  "pramipexole",
  "ropinirole",
  "levodopa",
  "carbidopa",
  "cabergoline",
  "bromocriptine",
  "betahistine",

  // Prescription NSAIDs, Muscle Relaxants & Anti-inflammatories
  "aceclofenac",
  "diclofenac",
  "etodolac",
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
  "thiocolchicoside",
  "chlorzoxazone",

  // Respiratory Rx & Misc Schedule H
  "montelukast",
  "formoterol",
  "salmeterol",
  "salbutamol",
  "levosalbutamol",
  "acebrophylline",
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
  "febuxostat",
  "allopurinol",
  "colchicine",
  "isotretinoin",
  "azelastine",
  "olopatadine",
] as const;

/**
 * Returns the matched Schedule H keywords for a given composition string (empty if non-Schedule H).
 */
export function getMatchedScheduleHSalts(compositionDisplay: string): string[] {
  if (!compositionDisplay || typeof compositionDisplay !== "string") {
    return [];
  }

  const salts = extractSaltNames(compositionDisplay);
  if (salts.length === 0) {
    return [];
  }

  const matched = new Set<string>();
  for (const salt of salts) {
    for (const keyword of SCHEDULE_H_KEYWORDS) {
      const regex = new RegExp(`\\b${escapeRegex(keyword)}\\b`, "i");
      if (regex.test(salt)) {
        matched.add(keyword);
      }
    }
  }

  return Array.from(matched);
}

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

  return getMatchedScheduleHSalts(compositionDisplay).length > 0;
}
