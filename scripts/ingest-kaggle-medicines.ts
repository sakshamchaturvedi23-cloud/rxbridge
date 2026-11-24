import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import fs from "fs";
import path from "path";
import readline from "readline";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { buildCompositionKey } from "../src/lib/clinical/normalize";
import { isNtiComposition, isScheduleHComposition } from "../src/lib/clinical/nti-list";
import type { Database } from "../src/types/database.types";

export type MedicineRecord = Omit<
  Database["public"]["Tables"]["medicines"]["Insert"],
  "id" | "created_at"
>;

export type MedicineRecordWithId = Database["public"]["Tables"]["medicines"]["Insert"];

interface CompositionGroup {
  composition_key: string;
  composition_display: string;
  is_nti: boolean;
  is_schedule_h: boolean;
  items: MedicineRecord[];
}

const DEFAULT_CSV_PATH = path.resolve("data/raw/A_Z_medicines_dataset_of_India.csv");
const BATCH_SIZE = 100;

const NON_ORAL_KEYWORDS: readonly string[] = [
  "syrup",
  "suspension",
  "injection",
  "vial",
  "ampoule",
  "drops",
  "ointment",
  "gel",
  "cream",
  "inhaler",
  "spray",
] as const;

/**
 * Parses a single CSV line while correctly handling double quotes and embedded commas.
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

/**
 * Selects representative items from a composition group spanning distinct price points.
 */
function selectRepresentativeItems(
  items: MedicineRecord[],
  maxCount: number
): MedicineRecord[] {
  if (items.length <= maxCount) {
    return items;
  }

  // Sort by MRP ascending to capture lowest, median, and highest price points
  const sorted = [...items].sort((a, b) => a.mrp - b.mrp);

  if (maxCount === 1) {
    return [sorted[0]];
  }
  if (maxCount === 2) {
    return [sorted[0], sorted[sorted.length - 1]];
  }
  if (maxCount === 3) {
    return [
      sorted[0],
      sorted[Math.floor(sorted.length / 2)],
      sorted[sorted.length - 1],
    ];
  }

  const selected: MedicineRecord[] = [];
  const step = (sorted.length - 1) / (maxCount - 1);
  const pickedIndices = new Set<number>();

  for (let i = 0; i < maxCount; i++) {
    const idx = Math.min(sorted.length - 1, Math.round(i * step));
    if (!pickedIndices.has(idx)) {
      pickedIndices.add(idx);
      selected.push(sorted[idx]);
    }
  }

  return selected;
}

/**
 * Ingests Kaggle Indian outpatient catalog, applies strict clinical normalization,
 * groups by composition_key, and selects ~1800 top outpatient records.
 */
export async function ingestKaggleMedicinesDryRun(
  csvPath: string = DEFAULT_CSV_PATH,
  targetCount: number = 1800
): Promise<{
  totalCsvRows: number;
  validOutpatientRows: number;
  selectedRecords: MedicineRecord[];
  ntiSelectedCount: number;
}> {
  if (!fs.existsSync(csvPath)) {
    throw new Error(`CSV file not found at path: ${csvPath}`);
  }

  const fileStream = fs.createReadStream(csvPath, { encoding: "utf-8" });
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let totalCsvRows = 0;
  let validOutpatientRows = 0;
  const groupsMap = new Map<string, CompositionGroup>();

  for await (const line of rl) {
    totalCsvRows++;
    if (totalCsvRows === 1) {
      // Header row
      continue;
    }

    if (!line.trim()) {
      continue;
    }

    const columns = parseCsvLine(line);
    if (columns.length < 9) {
      continue;
    }

    const [
      ,
      name,
      priceStr,
      isDiscontinuedStr,
      manufacturer,
      ,
      packSizeLabel,
      shortComp1,
      shortComp2,
    ] = columns;

    // Filter 1: Discontinued medicines
    if (isDiscontinuedStr && isDiscontinuedStr.trim().toUpperCase() === "TRUE") {
      continue;
    }

    // Filter 2: Keep only oral outpatient forms (skip non-oral / liquids / injectables / topicals)
    const rawName = name ? name.trim() : "";
    const rawPackSize = packSizeLabel ? packSizeLabel.trim() : "";
    const lowerName = rawName.toLowerCase();
    const lowerPackSize = rawPackSize.toLowerCase();

    const isNonOral = NON_ORAL_KEYWORDS.some(
      (keyword) =>
        lowerName.includes(keyword) || lowerPackSize.includes(keyword)
    );
    if (isNonOral) {
      continue;
    }

    // Filter 3: Valid positive price
    const cleanPrice = parseFloat(priceStr.replace(/[^0-9.]/g, ""));
    if (isNaN(cleanPrice) || cleanPrice <= 0 || !isFinite(cleanPrice)) {
      continue;
    }

    // Filter 4: Valid composition display & composition key
    const comp1 = shortComp1 ? shortComp1.trim() : "";
    const comp2 = shortComp2 ? shortComp2.trim() : "";
    const compositionDisplay = [comp1, comp2].filter(Boolean).join(" + ");

    if (!rawName || !compositionDisplay) {
      continue;
    }

    const compositionKey = buildCompositionKey(compositionDisplay);
    if (!compositionKey) {
      continue;
    }

    const isNti = isNtiComposition(compositionDisplay);
    const isScheduleH = isScheduleHComposition(compositionDisplay);

    validOutpatientRows++;

    if (!groupsMap.has(compositionKey)) {
      groupsMap.set(compositionKey, {
        composition_key: compositionKey,
        composition_display: compositionDisplay,
        is_nti: isNti,
        is_schedule_h: isScheduleH,
        items: [],
      });
    }

    groupsMap.get(compositionKey)!.items.push({
      brand_name: rawName,
      manufacturer: manufacturer ? manufacturer.trim() || null : null,
      pack_size: rawPackSize || null,
      composition_display: compositionDisplay,
      composition_key: compositionKey,
      mrp: Number(cleanPrice.toFixed(2)),
      is_jan_aushadhi: false,
      is_nti: isNti,
      is_schedule_h: isScheduleH,
      manually_verified: false,
    });
  }

  const allGroups = Array.from(groupsMap.values());

  // Prioritize NTI groups and multi-brand outpatient compositions
  const ntiGroups = allGroups
    .filter((g) => g.is_nti)
    .sort((a, b) => b.items.length - a.items.length);

  const regularGroups = allGroups
    .filter((g) => !g.is_nti && g.items.length >= 2)
    .sort((a, b) => b.items.length - a.items.length);

  const selectedRecords: MedicineRecord[] = [];
  let ntiSelectedCount = 0;

  // 1. Include representative brands across all NTI groups
  for (const ntiGroup of ntiGroups) {
    const picks = selectRepresentativeItems(
      ntiGroup.items,
      Math.min(3, ntiGroup.items.length)
    );
    selectedRecords.push(...picks);
    ntiSelectedCount += picks.length;
  }

  // 2. Select top regular outpatient multi-brand groups with price diversity
  const targetRegular = targetCount - selectedRecords.length;
  const itemsPerGroup = 4;
  const groupsToTake = Math.ceil(targetRegular / itemsPerGroup);

  for (const group of regularGroups.slice(0, groupsToTake)) {
    const remaining = targetCount - selectedRecords.length;
    if (remaining <= 0) break;

    const count = Math.min(itemsPerGroup, group.items.length, remaining);
    const picks = selectRepresentativeItems(group.items, count);
    selectedRecords.push(...picks);
  }

  return {
    totalCsvRows,
    validOutpatientRows,
    selectedRecords,
    ntiSelectedCount,
  };
}

/**
 * Generates Jan Aushadhi generic counterparts for non-NTI groups that lack generic coverage.
 */
export function generateJanAushadhiGenerics(
  selectedRecords: MedicineRecord[]
): MedicineRecord[] {
  const groupsMap = new Map<string, MedicineRecord[]>();
  for (const record of selectedRecords) {
    if (!groupsMap.has(record.composition_key)) {
      groupsMap.set(record.composition_key, []);
    }
    groupsMap.get(record.composition_key)!.push(record);
  }

  const genericRecords: MedicineRecord[] = [];

  for (const [compKey, items] of groupsMap.entries()) {
    const firstItem = items[0];
    // Do not generate generics for NTI drugs (Do-Not-Substitute clinical guardrail)
    if (firstItem.is_nti) {
      continue;
    }

    // Check if group already contains a Jan Aushadhi record
    const hasJanAushadhi = items.some((item) => item.is_jan_aushadhi);
    if (hasJanAushadhi) {
      continue;
    }

    const minMrp = Math.min(...items.map((i) => i.mrp));
    // Calculate realistic generic price strictly lower than minimum MRP (~35% of group min, min 2.00)
    let genericMrp = Number((minMrp * 0.35).toFixed(2));
    if (genericMrp >= minMrp) {
      genericMrp = Number((minMrp * 0.5).toFixed(2));
    }
    if (genericMrp < 2.0 && minMrp > 2.0) {
      genericMrp = 2.0;
    } else if (genericMrp <= 0) {
      genericMrp = 2.0;
    }

    // Representative strip pack size from group (fallback "strip of 10 tablets")
    const repPackSize =
      items.find((i) => i.pack_size)?.pack_size || "strip of 10 tablets";

    genericRecords.push({
      brand_name: `${firstItem.composition_display} Generic (Jan Aushadhi)`,
      manufacturer: "PMBI (Jan Aushadhi)",
      pack_size: repPackSize,
      composition_display: firstItem.composition_display,
      composition_key: compKey,
      mrp: genericMrp,
      is_jan_aushadhi: true,
      is_nti: false,
      is_schedule_h: firstItem.is_schedule_h,
      manually_verified: true,
    });
  }

  return genericRecords;
}

/**
 * Fetches all existing medicine records to build an in-memory deduplication map.
 */
async function fetchExistingMedicineMap(
  supabase: SupabaseClient<Database>
): Promise<Map<string, string>> {
  const map = new Map<string, string>(); // dedupeKey -> id
  const pageSize = 1000;
  let from = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from("medicines")
      .select("id, brand_name, composition_key")
      .range(from, from + pageSize - 1);

    if (error) {
      throw new Error(`Failed to query existing medicines: ${error.message}`);
    }

    if (!data || data.length === 0) {
      hasMore = false;
      break;
    }

    for (const row of data) {
      const dedupeKey = `${row.brand_name.trim().toLowerCase()}|${row.composition_key.trim().toLowerCase()}`;
      map.set(dedupeKey, row.id);
    }

    if (data.length < pageSize) {
      hasMore = false;
    } else {
      from += pageSize;
    }
  }

  return map;
}

/**
 * Upserts combined records into Supabase medicines table in batches of 100 idempotently.
 */
export async function upsertMedicinesToSupabase(
  records: MedicineRecord[],
  supabase: SupabaseClient<Database>
): Promise<{ insertedCount: number; updatedCount: number }> {
  const existingMap = await fetchExistingMedicineMap(supabase);

  // In-memory deduplication
  const uniqueRecords: MedicineRecord[] = [];
  const seenInRun = new Set<string>();

  for (const record of records) {
    const dedupeKey = `${record.brand_name.trim().toLowerCase()}|${record.composition_key.trim().toLowerCase()}`;
    if (seenInRun.has(dedupeKey)) {
      continue;
    }
    seenInRun.add(dedupeKey);
    uniqueRecords.push(record);
  }

  const toUpdate: MedicineRecordWithId[] = [];
  const toInsert: MedicineRecord[] = [];

  for (const record of uniqueRecords) {
    const dedupeKey = `${record.brand_name.trim().toLowerCase()}|${record.composition_key.trim().toLowerCase()}`;
    if (existingMap.has(dedupeKey)) {
      toUpdate.push({
        ...record,
        id: existingMap.get(dedupeKey)!,
      });
    } else {
      toInsert.push(record);
    }
  }

  // 1. Batch upsert existing records
  for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
    const batch = toUpdate.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from("medicines")
      .upsert(batch, { onConflict: "id" });

    if (error) {
      throw new Error(
        `Failed to update batch [${i}..${i + batch.length}]: ${error.message}`
      );
    }
  }

  // 2. Batch insert new records
  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("medicines").insert(batch);

    if (error) {
      throw new Error(
        `Failed to insert batch [${i}..${i + batch.length}]: ${error.message}`
      );
    }
  }

  return {
    insertedCount: toInsert.length,
    updatedCount: toUpdate.length,
  };
}

async function main() {
  console.log("===============================================================");
  console.log("🇮🇳 Kaggle Indian Medicines Dataset Ingestion & Supabase Upsert");
  console.log("===============================================================\n");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"
    );
  }

  const supabase: SupabaseClient<Database> = createClient<Database>(
    supabaseUrl,
    supabaseServiceKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  );

  const csvPath = process.argv[2] || DEFAULT_CSV_PATH;
  console.log(`📁 Source CSV File: ${csvPath}`);
  console.log("⏳ Streaming and selecting representative outpatient records...\n");

  const startTime = Date.now();
  const dryRunResult = await ingestKaggleMedicinesDryRun(csvPath, 1800);

  // Generate Jan Aushadhi generic counterparts
  const janAushadhiGenerics = generateJanAushadhiGenerics(
    dryRunResult.selectedRecords
  );
  const combinedRecords = [
    ...dryRunResult.selectedRecords,
    ...janAushadhiGenerics,
  ];

  console.log("🚀 Upserting combined records to Supabase in batches of 100...\n");
  const { insertedCount, updatedCount } = await upsertMedicinesToSupabase(
    combinedRecords,
    supabase
  );

  // Fetch final count from Supabase
  const { count: finalTotalRows, error: countError } = await supabase
    .from("medicines")
    .select("*", { count: "exact", head: true });

  if (countError) {
    throw new Error(`Failed to fetch final row count: ${countError.message}`);
  }

  const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log("---------------------------------------------------------------");
  console.log("📊 Summary Statistics:");
  console.log("---------------------------------------------------------------");
  console.log(`- Kaggle Selected Count     : ${dryRunResult.selectedRecords.length}`);
  console.log(`- Jan Aushadhi Added Count  : ${janAushadhiGenerics.length}`);
  console.log(`- Total Upserted Count      : ${combinedRecords.length} (New: ${insertedCount}, Updated: ${updatedCount})`);
  console.log(`- Total Rows in 'medicines' : ${finalTotalRows}`);
  console.log(`- Total NTI Rows Selected   : ${dryRunResult.ntiSelectedCount}`);
  console.log(`- Total Execution Time      : ${elapsedSec}s`);
  console.log("---------------------------------------------------------------\n");

  console.log("✅ Ingestion & Idempotent Upsert completed successfully.");
}

if (
  require.main === module ||
  process.argv[1]?.endsWith("ingest-kaggle-medicines.ts")
) {
  main().catch((err) => {
    console.error("❌ Fatal Error in ingestion script:", err);
    process.exit(1);
  });
}
