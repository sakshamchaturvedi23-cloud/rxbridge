/**
 * scripts/audit-and-fix-catalog.ts
 *
 * Read-only Catalog Audit & Dry-Run Repair Preview Script for RxBridge (P2).
 *
 * Default behavior:
 *   Strictly READ-ONLY dry-run. Reads `data/final_medicine.csv` (and optional `jan_aushadhi_core.csv`)
 *   and prints exact counts for:
 *   - NTI flag accuracy (missing NTI flags / false positives)
 *   - Schedule H flag accuracy (missing Schedule H flags)
 *   - Malformed `(NA)` / missing-strength composition strings
 *   - `manually_verified` provenance accuracy
 *   - `is_jan_aushadhi` provenance breakdown (PMBI vs non-PMBI manufacturers)
 *   - `composition_key` format divergence (`|` vs `+`, parentheses, `buildCompositionKey` vs `buildCanonicalCompositionKey`)
 *   - Dosage-form mixing across shared `composition_key`s & pack-size parse coverage
 *
 * Optional flags:
 *   --csv <path>          Input CSV path (default: data/final_medicine.csv)
 *   --out-preview <path>  Write JSON audit report to a separate file (never touches source CSV)
 *   --write-csv           Explicitly overwrite the CSV with repaired flags/canonical keys (OFF by default)
 *   --check-supabase      Read-only comparison against live Supabase `medicines` table (never writes)
 *
 * Owner: P2 (AI Extraction, Clinical Rules & Data Owner)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCanonicalCompositionKey,
  buildCompositionKey,
  detectDosageForm,
  parsePackSize,
  type DosageForm,
} from "../src/lib/clinical/normalize";
import { isNtiComposition, isScheduleHComposition } from "../src/lib/clinical/nti-list";

export interface CatalogCsvRow {
  id: string;
  brand_name: string;
  manufacturer: string;
  pack_size: string;
  composition_display: string;
  composition_key: string;
  mrp: string;
  is_jan_aushadhi: string;
  is_nti: string;
  is_schedule_h: string;
  manually_verified: string;
  created_at: string;
}

export interface CatalogAuditReport {
  mode: "dry_run" | "write_csv";
  csvPath: string;
  totalRows: number;
  dataIntegrity: {
    invalidMrpCount: number;
    missingManufacturerCount: number;
    missingPackSizeCount: number;
    duplicateBrandCount: number;
    duplicateBrandAndCanonicalKeyCount: number;
    unparsedPackSizeCount: number;
  };
  clinicalFlags: {
    currentNtiTrueCount: number;
    computedNtiTrueCount: number;
    missedNtiCount: number;
    falsePositiveNtiCount: number;
    missedNtiSamples: Array<{ brand_name: string; composition_display: string }>;
    currentScheduleHTrueCount: number;
    computedScheduleHTrueCount: number;
    missedScheduleHCount: number;
    missedScheduleHSamples: Array<{ brand_name: string; composition_display: string }>;
  };
  compositionAudit: {
    hasPipeDelimiterCount: number;
    hasPlusDelimiterCount: number;
    hasParenthesesCount: number;
    differsFromBuildCompositionKeyCount: number;
    differsFromCanonicalKeyCount: number;
    malformedNaCompositionCount: number;
    malformedNaSamples: Array<{ brand_name: string; composition_display: string; composition_key: string }>;
    amoxycillinVariantCount: number;
    uniqueStoredKeys: number;
    uniqueCanonicalKeys: number;
    janAushadhiStoredOverlapCount: number;
    janAushadhiCanonicalOverlapCount: number;
    mixedDosageFormStoredKeyCount: number;
    mixedDosageFormCanonicalKeyCount: number;
  };
  provenanceAudit: {
    currentManuallyVerifiedTrueCount: number;
    pmbiJanAushadhiCount: number;
    nonPmbiFlaggedJanAushadhiCount: number;
    nonPmbiJanAushadhiManufacturers: Record<string, number>;
    totalJanAushadhiFlaggedCount: number;
    unverifiedNonPmbiRowsCount: number;
  };
}

export function parseCsvLine(line: string): string[] {
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

function escapeCsvField(val: string): string {
  return `"${(val ?? "").replace(/"/g, '""')}"`;
}

export function loadCatalogCsv(csvPath: string): CatalogCsvRow[] {
  const content = fs.readFileSync(csvPath, "utf8");
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  const rows: CatalogCsvRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const record: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = cols[j] ?? "";
    }
    rows.push(record as unknown as CatalogCsvRow);
  }

  return rows;
}

export function auditCatalogRows(
  rows: CatalogCsvRow[],
  csvPath = "data/final_medicine.csv",
  mode: "dry_run" | "write_csv" = "dry_run"
): { report: CatalogAuditReport; repairedRows: CatalogCsvRow[] } {
  let invalidMrpCount = 0;
  let missingManufacturerCount = 0;
  let missingPackSizeCount = 0;
  let unparsedPackSizeCount = 0;

  let currentNtiTrueCount = 0;
  let computedNtiTrueCount = 0;
  let missedNtiCount = 0;
  let falsePositiveNtiCount = 0;
  const missedNtiSamples: Array<{ brand_name: string; composition_display: string }> = [];

  let currentScheduleHTrueCount = 0;
  let computedScheduleHTrueCount = 0;
  let missedScheduleHCount = 0;
  const missedScheduleHSamples: Array<{ brand_name: string; composition_display: string }> = [];

  let hasPipeDelimiterCount = 0;
  let hasPlusDelimiterCount = 0;
  let hasParenthesesCount = 0;
  let differsFromBuildCompositionKeyCount = 0;
  let differsFromCanonicalKeyCount = 0;
  let malformedNaCompositionCount = 0;
  const malformedNaSamples: Array<{
    brand_name: string;
    composition_display: string;
    composition_key: string;
  }> = [];
  let amoxycillinVariantCount = 0;

  let currentManuallyVerifiedTrueCount = 0;
  let pmbiJanAushadhiCount = 0;
  let nonPmbiFlaggedJanAushadhiCount = 0;
  let totalJanAushadhiFlaggedCount = 0;
  let unverifiedNonPmbiRowsCount = 0;
  const nonPmbiJanAushadhiManufacturers: Record<string, number> = {};

  const brandCounts = new Map<string, number>();
  const brandCanonicalCounts = new Map<string, number>();

  const storedKeys = new Set<string>();
  const canonicalKeys = new Set<string>();
  const jaStoredKeys = new Set<string>();
  const nonJaStoredKeys = new Set<string>();
  const jaCanonicalKeys = new Set<string>();
  const nonJaCanonicalKeys = new Set<string>();

  const formsByStoredKey = new Map<string, Set<DosageForm>>();
  const formsByCanonicalKey = new Map<string, Set<DosageForm>>();

  const repairedRows: CatalogCsvRow[] = [];

  for (const row of rows) {
    const brand = (row.brand_name || "").trim();
    const manufacturer = (row.manufacturer || "").trim();
    const packSize = (row.pack_size || "").trim();
    const compDisplay = (row.composition_display || "").trim();
    const storedKey = (row.composition_key || "").trim();
    const mrpNum = Number.parseFloat(row.mrp);

    if (!Number.isFinite(mrpNum) || mrpNum <= 0) invalidMrpCount++;
    if (!manufacturer) missingManufacturerCount++;
    if (!packSize) missingPackSizeCount++;
    if (packSize && parsePackSize(packSize).count === null) unparsedPackSizeCount++;

    const canonicalKey = buildCanonicalCompositionKey(compDisplay);
    const legacyNormKey = buildCompositionKey(compDisplay);

    const lowerBrand = brand.toLowerCase();
    brandCounts.set(lowerBrand, (brandCounts.get(lowerBrand) ?? 0) + 1);
    const bck = `${lowerBrand}::${canonicalKey}`;
    brandCanonicalCounts.set(bck, (brandCanonicalCounts.get(bck) ?? 0) + 1);

    // Clinical flags
    const curNti = row.is_nti === "true";
    const calcNti = isNtiComposition(compDisplay);
    if (curNti) currentNtiTrueCount++;
    if (calcNti) computedNtiTrueCount++;
    if (!curNti && calcNti) {
      missedNtiCount++;
      if (missedNtiSamples.length < 10) {
        missedNtiSamples.push({ brand_name: brand, composition_display: compDisplay });
      }
    } else if (curNti && !calcNti) {
      falsePositiveNtiCount++;
    }

    const curSchH = row.is_schedule_h === "true";
    const calcSchH = isScheduleHComposition(compDisplay);
    if (curSchH) currentScheduleHTrueCount++;
    if (calcSchH) computedScheduleHTrueCount++;
    if (!curSchH && calcSchH) {
      missedScheduleHCount++;
      if (missedScheduleHSamples.length < 10) {
        missedScheduleHSamples.push({ brand_name: brand, composition_display: compDisplay });
      }
    }

    // Composition key & string audit
    if (storedKey.includes("|")) hasPipeDelimiterCount++;
    if (storedKey.includes("+")) hasPlusDelimiterCount++;
    if (storedKey.includes("(") || storedKey.includes(")")) hasParenthesesCount++;
    if (storedKey !== legacyNormKey) differsFromBuildCompositionKeyCount++;
    if (storedKey !== canonicalKey) differsFromCanonicalKeyCount++;

    if (/\(na\)/i.test(compDisplay) || /\(na\)/i.test(storedKey)) {
      malformedNaCompositionCount++;
      if (malformedNaSamples.length < 10) {
        malformedNaSamples.push({
          brand_name: brand,
          composition_display: compDisplay,
          composition_key: storedKey,
        });
      }
    }

    if (/amoxycillin/i.test(compDisplay)) {
      amoxycillinVariantCount++;
    }

    storedKeys.add(storedKey);
    canonicalKeys.add(canonicalKey);

    const isJa = row.is_jan_aushadhi === "true";
    if (isJa) {
      totalJanAushadhiFlaggedCount++;
      jaStoredKeys.add(storedKey);
      jaCanonicalKeys.add(canonicalKey);
      if (/pmbi|jan aushadhi/i.test(manufacturer)) {
        pmbiJanAushadhiCount++;
      } else {
        nonPmbiFlaggedJanAushadhiCount++;
        nonPmbiJanAushadhiManufacturers[manufacturer] =
          (nonPmbiJanAushadhiManufacturers[manufacturer] ?? 0) + 1;
      }
    } else {
      nonJaStoredKeys.add(storedKey);
      nonJaCanonicalKeys.add(canonicalKey);
    }

    if (row.manually_verified === "true") {
      currentManuallyVerifiedTrueCount++;
    }
    if (!/pmbi|jan aushadhi/i.test(manufacturer)) {
      unverifiedNonPmbiRowsCount++;
    }

    const form = detectDosageForm(brand, packSize, compDisplay);
    if (!formsByStoredKey.has(storedKey)) formsByStoredKey.set(storedKey, new Set());
    formsByStoredKey.get(storedKey)!.add(form);

    if (!formsByCanonicalKey.has(canonicalKey)) formsByCanonicalKey.set(canonicalKey, new Set());
    formsByCanonicalKey.get(canonicalKey)!.add(form);

    repairedRows.push({
      ...row,
      composition_key: canonicalKey || storedKey,
      is_nti: String(calcNti),
      is_schedule_h: String(calcSchH),
      manually_verified: String(/pmbi|jan aushadhi/i.test(manufacturer)),
    });
  }

  let duplicateBrandCount = 0;
  for (const c of brandCounts.values()) {
    if (c > 1) duplicateBrandCount += c - 1;
  }
  let duplicateBrandAndCanonicalKeyCount = 0;
  for (const c of brandCanonicalCounts.values()) {
    if (c > 1) duplicateBrandAndCanonicalKeyCount += c - 1;
  }

  let janAushadhiStoredOverlapCount = 0;
  for (const k of jaStoredKeys) {
    if (nonJaStoredKeys.has(k)) janAushadhiStoredOverlapCount++;
  }
  let janAushadhiCanonicalOverlapCount = 0;
  for (const k of jaCanonicalKeys) {
    if (nonJaCanonicalKeys.has(k)) janAushadhiCanonicalOverlapCount++;
  }

  const countMixedForms = (m: Map<string, Set<DosageForm>>) => {
    let count = 0;
    for (const forms of m.values()) {
      const concrete = Array.from(forms).filter((f) => f !== "unknown");
      if (concrete.length > 1) count++;
    }
    return count;
  };

  return {
    report: {
      mode,
      csvPath,
      totalRows: rows.length,
      dataIntegrity: {
        invalidMrpCount,
        missingManufacturerCount,
        missingPackSizeCount,
        duplicateBrandCount,
        duplicateBrandAndCanonicalKeyCount,
        unparsedPackSizeCount,
      },
      clinicalFlags: {
        currentNtiTrueCount,
        computedNtiTrueCount,
        missedNtiCount,
        falsePositiveNtiCount,
        missedNtiSamples,
        currentScheduleHTrueCount,
        computedScheduleHTrueCount,
        missedScheduleHCount,
        missedScheduleHSamples,
      },
      compositionAudit: {
        hasPipeDelimiterCount,
        hasPlusDelimiterCount,
        hasParenthesesCount,
        differsFromBuildCompositionKeyCount,
        differsFromCanonicalKeyCount,
        malformedNaCompositionCount,
        malformedNaSamples,
        amoxycillinVariantCount,
        uniqueStoredKeys: storedKeys.size,
        uniqueCanonicalKeys: canonicalKeys.size,
        janAushadhiStoredOverlapCount,
        janAushadhiCanonicalOverlapCount,
        mixedDosageFormStoredKeyCount: countMixedForms(formsByStoredKey),
        mixedDosageFormCanonicalKeyCount: countMixedForms(formsByCanonicalKey),
      },
      provenanceAudit: {
        currentManuallyVerifiedTrueCount,
        pmbiJanAushadhiCount,
        nonPmbiFlaggedJanAushadhiCount,
        nonPmbiJanAushadhiManufacturers,
        totalJanAushadhiFlaggedCount,
        unverifiedNonPmbiRowsCount,
      },
    },
    repairedRows,
  };
}

function writeCatalogCsv(outPath: string, rows: CatalogCsvRow[]) {
  const headers: Array<keyof CatalogCsvRow> = [
    "id",
    "brand_name",
    "manufacturer",
    "pack_size",
    "composition_display",
    "composition_key",
    "mrp",
    "is_jan_aushadhi",
    "is_nti",
    "is_schedule_h",
    "manually_verified",
    "created_at",
  ];
  const lines = [headers.map((h) => escapeCsvField(h)).join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => escapeCsvField(r[h] ?? "")).join(","));
  }
  fs.writeFileSync(outPath, `${lines.join("\n")}\n`, "utf8");
}

async function checkSupabaseReadOnly() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.log("Supabase check skipped: NEXT_PUBLIC_SUPABASE_URL / key not configured.");
    return;
  }
  const { createClient } = await import("@supabase/supabase-js");
  const sb = createClient(url, key, { auth: { persistSession: false } });
  const { count: totalCount } = await sb.from("medicines").select("*", { count: "exact", head: true });
  const { count: ntiCount } = await sb
    .from("medicines")
    .select("*", { count: "exact", head: true })
    .eq("is_nti", true);
  const { count: schCount } = await sb
    .from("medicines")
    .select("*", { count: "exact", head: true })
    .eq("is_schedule_h", true);

  console.log("\n=== Supabase Read-Only Snapshot ===");
  console.log({ totalCount, ntiCount, schCount });
}

async function main() {
  const args = process.argv.slice(2);
  const csvIdx = args.indexOf("--csv");
  const csvPath = csvIdx >= 0 && args[csvIdx + 1] ? args[csvIdx + 1] : "data/final_medicine.csv";
  const outIdx = args.indexOf("--out-preview");
  const outPreviewPath = outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : null;
  const writeCsv = args.includes("--write-csv");
  const checkSupabase = args.includes("--check-supabase");

  const resolvedCsv = path.resolve(csvPath);
  if (!fs.existsSync(resolvedCsv)) {
    console.error(`Catalog CSV not found: ${resolvedCsv}`);
    process.exit(1);
  }

  const rows = loadCatalogCsv(resolvedCsv);
  const { report, repairedRows } = auditCatalogRows(
    rows,
    csvPath,
    writeCsv ? "write_csv" : "dry_run"
  );

  console.log("=== RxBridge Catalog Audit Report ===");
  console.log(JSON.stringify(report, null, 2));

  if (outPreviewPath) {
    const resolvedPreview = path.resolve(outPreviewPath);
    fs.mkdirSync(path.dirname(resolvedPreview), { recursive: true });
    fs.writeFileSync(resolvedPreview, JSON.stringify(report, null, 2), "utf8");
    console.log(`\nPreview audit report written to: ${outPreviewPath}`);
  }

  if (writeCsv) {
    writeCatalogCsv(resolvedCsv, repairedRows);
    console.log(`\nUpdated CSV written to: ${csvPath}`);
  } else {
    console.log("\n[DRY RUN] No CSV files or Supabase records were modified.");
  }

  if (checkSupabase) {
    await checkSupabaseReadOnly();
  }
}

const isEntrypoint =
  typeof process !== "undefined" &&
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  main().catch((err) => {
    console.error("Catalog audit failed:", err);
    process.exit(1);
  });
}
