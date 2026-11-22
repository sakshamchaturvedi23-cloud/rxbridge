/**
 * scripts/seed-ocr-aliases.ts
 *
 * Seeds verified Indian prescription OCR aliases & shorthand variations into `ocr_aliases`.
 * Resolves all aliases dynamically against real medicines already present in Supabase.
 * Enforces 100% idempotency via onConflict: "raw_text".
 *
 * Owner: P2 (AI Extraction, Clinical Rules & Data Owner)
 * Branch: p2-ai-data
 */

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database.types";

interface MedicineRow {
  id: string;
  brand_name: string;
  composition_key: string;
  is_jan_aushadhi: boolean;
  is_nti: boolean;
  manually_verified: boolean;
}

interface PreparedAlias {
  raw_text: string;
  matched_medicine_id: string;
  brand_name: string;
  manually_verified: boolean;
}

async function fetchAllMedicines(
  supabase: ReturnType<typeof createClient<Database>>
): Promise<MedicineRow[]> {
  const allMeds: MedicineRow[] = [];
  let from = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from("medicines")
      .select("id, brand_name, composition_key, is_jan_aushadhi, is_nti, manually_verified")
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Failed to fetch medicines at offset ${from}: ${error.message}`);
    }

    if (!data || data.length === 0) {
      break;
    }

    allMeds.push(...(data as MedicineRow[]));

    if (data.length < pageSize) {
      break;
    }

    from += pageSize;
  }

  return allMeds;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      "Missing Supabase credentials in .env.local: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."
    );
    process.exit(1);
  }

  const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  console.log("=== Seeding OCR Aliases ===");
  console.log("1. Fetching existing medicines from Supabase...");

  const allMeds = await fetchAllMedicines(supabase);
  console.log(`   Fetched ${allMeds.length} total medicine records from Supabase.`);

  // Build fast indexing structures for resolution
  const exactMap = new Map<string, MedicineRow>();
  const normMap = new Map<string, MedicineRow>();

  for (const med of allMeds) {
    const key = med.brand_name.toLowerCase().trim();
    const normKey = key.replace(/[^a-z0-9]/g, "");

    // Prioritize manually_verified non-generic medicines
    if (!exactMap.has(key) || (med.manually_verified && !med.is_jan_aushadhi)) {
      exactMap.set(key, med);
    }
    if (!normMap.has(normKey) || (med.manually_verified && !med.is_jan_aushadhi)) {
      normMap.set(normKey, med);
    }
  }

  function resolveBrand(name: string): MedicineRow | undefined {
    const k = name.toLowerCase().trim();
    if (exactMap.has(k)) return exactMap.get(k);

    const nk = k.replace(/[^a-z0-9]/g, "");
    if (normMap.has(nk)) return normMap.get(nk);

    // Strip outpatient packaging words (e.g., "Tablet", "Capsule", "Strip")
    for (const med of allMeds) {
      if (med.is_jan_aushadhi) continue;
      const strippedBrand = med.brand_name
        .toLowerCase()
        .replace(/\s+(tablet|capsule|strip|cap|tab).*$/i, "")
        .trim();
      if (strippedBrand === k) return med;
      if (strippedBrand.replace(/[^a-z0-9]/g, "") === nk) return med;
    }

    // Omeprazole 20mg fallback for standard PPI shorthand
    if (k.includes("omez 20")) {
      return allMeds.find(
        (m) => !m.is_jan_aushadhi && m.composition_key === "omeprazole-20mg"
      );
    }

    return undefined;
  }

  console.log("2. Generating OCR aliases & prescription shorthands...");

  const aliasMap = new Map<string, PreparedAlias>();
  const matchedBrandNames = new Set<string>();

  function addAlias(rawText: string, med: MedicineRow) {
    const clean = rawText.trim().toLowerCase();
    if (!clean || clean.length < 2) return;

    const existing = aliasMap.get(clean);
    if (!existing) {
      aliasMap.set(clean, {
        raw_text: clean,
        matched_medicine_id: med.id,
        brand_name: med.brand_name,
        manually_verified: med.manually_verified,
      });
      matchedBrandNames.add(med.brand_name);
    } else if (!existing.manually_verified && med.manually_verified) {
      aliasMap.set(clean, {
        raw_text: clean,
        matched_medicine_id: med.id,
        brand_name: med.brand_name,
        manually_verified: med.manually_verified,
      });
      matchedBrandNames.add(med.brand_name);
    }
  }

  // --- Category A: Curated High-Frequency Prescription Shorthands ---
  const CURATED_SHORTHANDS: Record<string, string[]> = {
    "Augmentin 625 Duo": [
      "aug 625",
      "tab aug 625",
      "tab. aug 625",
      "t. aug 625",
      "aug-625",
      "aug625",
      "augmentin 625",
      "augmentin 625 duo",
      "tab augmentin 625",
      "tab augmentin 625 duo",
      "tab. augmentin 625",
      "tab. augmentin 625 duo",
      "tab aug 625 duo",
      "augmentin duo 625",
      "augmentin-625",
      "tab augmentin",
    ],
    "Dolo 650": [
      "tab dolo 650",
      "tab. dolo 650",
      "tabdolo 650",
      "tabdolo650",
      "dolo 650",
      "dolo650",
      "dolo 650mg",
      "tab dolo",
      "t. dolo 650",
      "dolo-650",
    ],
    "Calpol 650": [
      "tab calpol 650",
      "tab. calpol 650",
      "tabcalpol 650",
      "calpol 650",
      "calpol650",
      "tab calpol",
      "calpol 650mg",
      "calpol-650",
      "t. calpol 650",
    ],
    "Calpol 500": [
      "tab calpol 500",
      "tab. calpol 500",
      "calpol 500",
      "calpol500",
      "calpol 500mg",
    ],
    "Crocin Advance 650": [
      "tab crocin advance 650",
      "tab crocin advance",
      "crocin advance 650",
      "crocin advance",
      "tab crocin 650",
      "crocin 650",
    ],
    "Crocin 500": ["tab crocin 500", "crocin 500", "tab crocin", "crocin500"],
    "Pacimol 650": ["tab pacimol 650", "pacimol 650", "tab pacimol"],
    "Pan 40": [
      "tab pan 40",
      "tab. pan 40",
      "tabpan 40",
      "pan 40",
      "pan40",
      "tab pan40",
      "tab pan",
      "pan-40",
      "tab pan-40",
      "t. pan 40",
    ],
    "Pan-D": [
      "cap pan d",
      "cap pan-d",
      "cap. pan d",
      "cap. pan-d",
      "tab pan d",
      "tab pan-d",
      "pan-d",
      "pan d",
      "pand",
      "c. pan d",
    ],
    "Pantocid 40": ["tab pantocid 40", "pantocid 40", "pantocid40"],
    "Pantocid-D SR": [
      "cap pantocid d sr",
      "cap pantocid-d sr",
      "pantocid d sr",
      "pantocid-d sr",
      "pantocid dsr",
    ],
    "Omez 20": [
      "cap omez 20",
      "cap. omez 20",
      "tab omez 20",
      "omez 20",
      "omez20",
      "cap omez",
    ],
    "Telma 40": [
      "tab telma 40",
      "tab. telma 40",
      "tabtelma 40",
      "telma 40",
      "telma40",
      "tab telma",
      "telma-40",
      "t. telma 40",
    ],
    "Telma-AM": ["tab telma am", "tab telma-am", "telma am", "telma-am"],
    "Telmikind 40": ["tab telmikind 40", "telmikind 40", "telmikind40"],
    "Telpres 40": ["tab telpres 40", "telpres 40"],
    "Amlong 5": [
      "tab amlong 5",
      "tab. amlong 5",
      "tabamlong 5",
      "amlong 5",
      "amlong5",
      "tab amlong",
      "amlong-5",
    ],
    "Glycomet 500 SR": [
      "tab glycomet 500",
      "tab glycomet 500 sr",
      "tab. glycomet 500",
      "tabglycomet 500",
      "glycomet 500",
      "glycomet 500 sr",
      "glycomet500",
      "tab glycomet",
      "glycomet 500sr",
    ],
    "Glycomet-GP 1": [
      "tab glycomet gp 1",
      "tab glycomet-gp 1",
      "glycomet gp 1",
      "glycomet-gp 1",
      "glycomet gp1",
    ],
    "Glycomet-GP 2": [
      "tab glycomet gp 2",
      "tab glycomet-gp 2",
      "glycomet gp 2",
      "glycomet-gp 2",
      "glycomet gp2",
    ],
    "Atorva 10": [
      "tab atorva 10",
      "tab. atorva 10",
      "tabatorva 10",
      "atorva 10",
      "atorva10",
      "tab atorva",
    ],
    "Storvas 10": ["tab storvas 10", "storvas 10", "storvas10"],
    "Azithral 500": [
      "tab azithral 500",
      "tab. azithral 500",
      "tabazithral 500",
      "azithral 500",
      "azithral500",
      "tab azithral",
      "azithral-500",
    ],
    "Azee 500": ["tab azee 500", "azee 500", "azee500", "tab azee"],
    "Shelcal 500": [
      "tab shelcal 500",
      "tab. shelcal 500",
      "shelcal 500",
      "shelcal500",
      "tab shelcal",
      "shelcal-500",
    ],
    "Montair-LC": [
      "tab montair lc",
      "tab. montair lc",
      "tab montair-lc",
      "montair lc",
      "montair-lc",
      "montairlc",
      "tab montair",
    ],
    "Montek-LC": ["tab montek lc", "montek lc", "montek-lc"],
    "EcoSprin 75": [
      "tab ecosprin 75",
      "tab. ecosprin 75",
      "tabecosprin 75",
      "ecosprin 75",
      "ecosprin75",
      "tab ecosprin",
      "ecosprin-75",
    ],
    "Eltroxin 50mcg": [
      "tab eltroxin 50",
      "tab eltroxin 50mcg",
      "tab. eltroxin 50",
      "eltroxin 50",
      "eltroxin 50mcg",
      "eltroxin50",
      "tab eltroxin",
    ],
    "Thyronorm 50mcg": [
      "tab thyronorm 50",
      "tab thyronorm 50mcg",
      "tab. thyronorm 50",
      "thyronorm 50",
      "thyronorm 50mcg",
      "thyronorm50",
      "tab thyronorm",
    ],
    "Thyronorm 25mcg": [
      "tab thyronorm 25",
      "tab thyronorm 25mcg",
      "thyronorm 25",
      "thyronorm 25mcg",
    ],
    "Eptoin 100mg": [
      "tab eptoin 100",
      "tab eptoin 100mg",
      "tab. eptoin 100",
      "eptoin 100",
      "eptoin 100mg",
      "eptoin100",
      "tab eptoin",
    ],
    "Tegretol 200mg": [
      "tab tegretol 200",
      "tab tegretol 200mg",
      "tegretol 200",
      "tegretol 200mg",
      "tab tegretol",
    ],
    "Warf 5mg": ["tab warf 5", "tab warf 5mg", "warf 5", "warf 5mg", "tab warf"],
    "Lanoxin 0.25mg": [
      "tab lanoxin 0.25",
      "tab lanoxin 0.25mg",
      "lanoxin 0.25",
      "lanoxin 0.25mg",
      "tab lanoxin",
    ],
    "Mahacef 200": ["tab mahacef 200", "mahacef 200", "mahacef200", "tab mahacef"],
    "Taxim-O 200": [
      "tab taxim o 200",
      "tab taxim-o 200",
      "taxim o 200",
      "taxim-o 200",
      "taximo 200",
    ],
    "Cetzine 10": ["tab cetzine 10", "cetzine 10", "cetzine10", "tab cetzine"],
    "Cifran 500": ["tab cifran 500", "cifran 500", "cifran500"],
    "Ciplox 500": ["tab ciplox 500", "ciplox 500", "ciplox500"],
    "Combiflam": ["tab combiflam", "tab. combiflam", "combiflam"],
    "Allegra 120": [
      "tab allegra 120",
      "allegra 120",
      "allegra120",
      "tab allegra",
    ],
    "Moxikind-CV 625": [
      "tab moxikind cv 625",
      "tab moxikind-cv 625",
      "moxikind cv 625",
      "moxikind-cv 625",
      "moxikind 625",
    ],
    "Clavam 625": ["tab clavam 625", "clavam 625", "clavam625"],
    "Zerodol-SP": [
      "tab zerodol sp",
      "tab zerodol-sp",
      "zerodol sp",
      "zerodol-sp",
    ],
    "Aceclo-SP": ["tab aceclo sp", "tab aceclo-sp", "aceclo sp", "aceclo-sp"],
    "Zifi 200": ["tab zifi 200", "zifi 200", "zifi200"],
    "Rantac 150": ["tab rantac 150", "rantac 150"],
    "Zinetac 150": ["tab zinetac 150", "zinetac 150"],
    "Zyrtec 10": ["tab zyrtec 10", "zyrtec 10"],
    "Alerid 10": ["tab alerid 10", "alerid 10"],
    "Metrogyl 400": ["tab metrogyl 400", "metrogyl 400"],
    "Flagyl 400": ["tab flagyl 400", "flagyl 400"],
    "Bisoheart 5": ["tab bisoheart 5", "bisoheart 5"],
    "Concor 5": ["tab concor 5", "concor 5"],
    "Cipcal 500": ["tab cipcal 500", "cipcal 500"],
    "Signoflam": ["tab signoflam", "signoflam"],
    "Ibugesic Plus": ["tab ibugesic plus", "ibugesic plus"],
    "Glimisave M1": ["tab glimisave m1", "glimisave m1"],
    "Glimisave M2": ["tab glimisave m2", "glimisave m2"],
    "Lipikind 10": ["tab lipikind 10", "lipikind 10"],
    "Rosuvas 10": ["tab rosuvas 10", "rosuvas 10"],
    "Rosave 10": ["tab rosave 10", "rosave 10"],
    "Rozavel 10": ["tab rozavel 10", "rozavel 10"],
    "Stamlo 5": ["tab stamlo 5", "stamlo 5"],
    "Obimet 500 SR": ["tab obimet 500", "obimet 500", "obimet 500 sr"],
    "Pantodac 40": ["tab pantodac 40", "pantodac 40"],
    "Pantocar-D": ["cap pantocar d", "pantocar d", "pantocar-d"],
    "Lithosun SR 400mg": [
      "tab lithosun 400",
      "lithosun 400",
      "lithosun sr 400",
    ],
    "Mazetol 200mg": ["tab mazetol 200", "mazetol 200"],
    "Valparin Chrono 500mg": ["tab valparin 500", "valparin 500"],
    "Pangraf 1mg": [
      "cap pangraf 1mg",
      "cap pangraf 1",
      "tab pangraf 1mg",
      "pangraf 1mg",
    ],
  };

  for (const [targetBrand, aliases] of Object.entries(CURATED_SHORTHANDS)) {
    const med = resolveBrand(targetBrand);
    if (!med) {
      console.warn(`   [Warning] Target brand "${targetBrand}" could not be resolved against database.`);
      continue;
    }
    for (const a of aliases) {
      addAlias(a, med);
    }
  }

  // --- Category B: Systematic Variations for All Manually Verified Branded Medicines ---
  const verifiedNonGeneric = allMeds.filter(
    (m) => m.manually_verified && !m.is_jan_aushadhi
  );
  for (const med of verifiedNonGeneric) {
    const raw = med.brand_name.toLowerCase().trim();
    addAlias(raw, med);
    addAlias(`tab ${raw}`, med);
    addAlias(`tab. ${raw}`, med);

    if (raw.includes("-") || raw.includes("/")) {
      const unhyphenated = raw.replace(/[-/]/g, " ").replace(/\s+/g, " ").trim();
      addAlias(unhyphenated, med);
      addAlias(`tab ${unhyphenated}`, med);
      addAlias(`tab. ${unhyphenated}`, med);
    }

    // Number attachment variations: e.g. "dolo 650" -> "dolo650"
    const match = raw.match(/^([a-z-]+)\s+(\d+(?:\.\d+)?(?:mg|mcg)?)$/i);
    if (match) {
      const namePart = match[1];
      const dosePart = match[2];
      addAlias(`${namePart}${dosePart}`, med);
      addAlias(`tab ${namePart}${dosePart}`, med);

      const doseNum = dosePart.replace(/(mg|mcg)$/i, "");
      if (doseNum !== dosePart) {
        addAlias(`${namePart} ${doseNum}`, med);
        addAlias(`tab ${namePart} ${doseNum}`, med);
        addAlias(`${namePart}${doseNum}`, med);
      }
    }
  }

  // --- Category C: Packaging Strips & Outpatient Aliases for Non-Generic Kaggle Medicines ---
  const kaggleOutpatient = allMeds.filter(
    (m) => !m.manually_verified && !m.is_jan_aushadhi
  );
  for (const med of kaggleOutpatient) {
    const raw = med.brand_name.toLowerCase().trim();
    addAlias(raw, med);

    const stripped = raw
      .replace(/\s+(tablet|capsule|strip|cap|tab).*$/i, "")
      .trim();
    if (stripped !== raw && stripped.length > 2) {
      addAlias(stripped, med);
      addAlias(`tab ${stripped}`, med);
      addAlias(`tab. ${stripped}`, med);

      if (stripped.includes("-") || stripped.includes("/")) {
        const unhyphenated = stripped.replace(/[-/]/g, " ").replace(/\s+/g, " ").trim();
        addAlias(unhyphenated, med);
        addAlias(`tab ${unhyphenated}`, med);
      }
    }
  }

  const preparedList = Array.from(aliasMap.values());
  console.log(`   Prepared ${preparedList.length} unique aliases across ${matchedBrandNames.size} distinct brands.`);

  // 3. Batch Upsert into ocr_aliases
  console.log("3. Upserting aliases into Supabase ocr_aliases table (batches of 100)...");
  const batchSize = 100;
  let upsertedCount = 0;

  for (let i = 0; i < preparedList.length; i += batchSize) {
    const batch = preparedList.slice(i, i + batchSize).map((a) => ({
      raw_text: a.raw_text,
      matched_medicine_id: a.matched_medicine_id,
      correction_count: 1,
    }));

    const { error: upsertError } = await supabase
      .from("ocr_aliases")
      .upsert(batch, { onConflict: "raw_text" });

    if (upsertError) {
      throw new Error(`Failed to upsert batch at index ${i}: ${upsertError.message}`);
    }

    upsertedCount += batch.length;
    if (upsertedCount % 1000 === 0 || upsertedCount === preparedList.length) {
      console.log(`   Progress: ${upsertedCount}/${preparedList.length} aliases upserted.`);
    }
  }

  // 4. Fetch final count and print summary stats
  const { count: finalCount, error: countError } = await supabase
    .from("ocr_aliases")
    .select("*", { count: "exact", head: true });

  if (countError) {
    throw new Error(`Failed to get final count of ocr_aliases: ${countError.message}`);
  }

  console.log("\n=== Summary Stats ===");
  console.log(`Matched Brands Count:     ${matchedBrandNames.size}`);
  console.log(`Total Aliases Prepared:   ${preparedList.length}`);
  console.log(`Inserted/Updated Count:   ${upsertedCount}`);
  console.log(`Final ocr_aliases Count:  ${finalCount ?? 0}`);
  console.log("=====================\n");
}

main().catch((err) => {
  console.error("Execution failed:", err);
  process.exit(1);
});
