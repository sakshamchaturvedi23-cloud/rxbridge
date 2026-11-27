import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { buildCanonicalCompositionKey } from "../src/lib/clinical/normalize";
import { isNtiComposition, isScheduleHComposition } from "../src/lib/clinical/nti-list";

const CSV_PATH = path.resolve("data/raw/A_Z_medicines_dataset_of_India.csv");
const CACHE_PATH = path.resolve("data/ai-curated-scores.json");
const TARGET_BRANDED_COUNT = 4500;
const BATCH_SIZE = 200;
const CONCURRENCY = 1;

interface RawCandidate {
  id: string;
  name: string;
  mrp: number;
  manufacturer: string;
  packSize: string;
  compositionDisplay: string;
  compositionKey: string;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function makeCompositionKey(c1: string, c2: string): string {
  return buildCanonicalCompositionKey([c1, c2].filter(Boolean).join(" + "));
}

function buildCandidatePool(): RawCandidate[] {
  const lines = fs.readFileSync(CSV_PATH, "utf8").split(/\r?\n/);
  const groups = new Map<string, RawCandidate[]>();

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const cols = parseCsvLine(line);
    if (cols.length < 9) continue;

    const [id, name, priceStr, isDiscontinued, manufacturer, type, packSize, sc1, sc2] = cols;
    if ((isDiscontinued || "").trim().toUpperCase() === "TRUE") continue;
    if ((type || "").trim().toLowerCase() !== "allopathy") continue;

    const brand = (name || "").trim();
    const c1 = (sc1 || "").trim();
    const c2 = (sc2 || "").trim();
    const mrp = parseFloat((priceStr || "").replace(/[^0-9.]/g, ""));
    if (!brand || !c1 || !Number.isFinite(mrp) || mrp <= 0) continue;

    // Skip hospital-only IV fluids / vaccines / surgicals, keep OPD tabs/caps/syrups/drops/inhalers/gels
    if (/\b(iv|infusion|vial|ampoule|vaccine|sera|dialysis|saline)\b/i.test(brand)) continue;

    const compositionDisplay = [c1, c2].filter(Boolean).join(" + ");
    const compositionKey = makeCompositionKey(c1, c2);

    const item: RawCandidate = {
      id: id.trim(),
      name: brand,
      mrp: Number(mrp.toFixed(2)),
      manufacturer: (manufacturer || "Unknown").trim(),
      packSize: (packSize || "").trim(),
      compositionDisplay,
      compositionKey,
    };

    const arr = groups.get(compositionKey) ?? [];
    arr.push(item);
    groups.set(compositionKey, arr);
  }

  // Keep up to 5 distinct-manufacturer candidates per composition (~12k-15k pool)
  const pool: RawCandidate[] = [];
  for (const items of groups.values()) {
    const seenMfg = new Set<string>();
    for (const item of items) {
      const mfgKey = item.manufacturer.toLowerCase().slice(0, 12);
      if (seenMfg.has(mfgKey) && items.length > 5) continue;
      seenMfg.add(mfgKey);
      pool.push(item);
      if (pool.length % 5 === 0 && seenMfg.size >= 5) break;
    }
  }
  return pool;
}

async function scoreBatch(batch: RawCandidate[], attempt = 1): Promise<Record<string, number>> {
  const baseUrl = process.env.VISION_LLM_BASE_URL!;
  const apiKey = process.env.VISION_LLM_API_KEY!;
  const model = process.env.VISION_LLM_MODEL || "gemini-flash-lite-latest";

  const payload = batch.map((b) => ({
    id: b.id,
    n: b.name,
    m: b.manufacturer,
    c: b.compositionDisplay,
  }));

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(45000),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are an Indian clinical pharmacist. Rate each medicine from 0 to 100 on how frequently Indian OPD doctors prescribe that exact brand in everyday clinics (90-100 = household/top OPD brand like Dolo, Pan-D, Augmentin, Sumoflam, Omnacortil, Telma, Vertin, Meftal-Spas; 70-89 = common mainstream brand; 0-40 = obscure/rare). Return ONLY JSON: {\"scores\":{\"<id>\":<0-100>}}.",
        },
        {
          role: "user",
          content: JSON.stringify(payload),
        },
      ],
    }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    const msg = data.error?.message || `HTTP ${res.status}`;
    if (attempt <= 4 && /rate-limited|cooldown|exhausted|429/i.test(msg)) {
      const resetMatch = msg.match(/reset ~?(\d+)s/i);
      const waitMs = (resetMatch ? Number(resetMatch[1]) + 2 : 12) * 1000;
      console.log(`⏳ Rate-limited (attempt ${attempt}/4), waiting ${Math.round(waitMs / 1000)}s...`);
      await new Promise((r) => setTimeout(r, waitMs));
      return scoreBatch(batch, attempt + 1);
    }
    throw new Error(msg);
  }
  const raw = (data.choices?.[0]?.message?.content || "{}").replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(raw);
  await new Promise((r) => setTimeout(r, 1500));
  return parsed.scores || {};
}

async function main() {
  const pool = buildCandidatePool();
  console.log(`📦 Candidate pool built: ${pool.length} medicines`);

  const cache: Record<string, number> = fs.existsSync(CACHE_PATH)
    ? JSON.parse(fs.readFileSync(CACHE_PATH, "utf8"))
    : {};

  const uncached = pool.filter((p) => typeof cache[p.id] !== "number");
  console.log(`🧠 Cached: ${Object.keys(cache).length} | Remaining to AI-score: ${uncached.length}`);

  const batches: RawCandidate[][] = [];
  for (let i = 0; i < uncached.length; i += BATCH_SIZE) {
    batches.push(uncached.slice(i, i + BATCH_SIZE));
  }

  let cursor = 0;
  async function worker() {
    while (cursor < batches.length) {
      const idx = cursor++;
      const batch = batches[idx];
      try {
        const scores = await scoreBatch(batch);
        for (const item of batch) {
          cache[item.id] = typeof scores[item.id] === "number" ? scores[item.id] : 0;
        }
        fs.writeFileSync(CACHE_PATH, JSON.stringify(cache));
        console.log(`✅ Batch ${idx + 1}/${batches.length} scored (total cached: ${Object.keys(cache).length})`);
      } catch (err) {
        console.warn(`⚠️ Batch ${idx + 1} failed:`, (err as Error).message);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  const ranked = pool
    .map((p) => ({ ...p, aiScore: cache[p.id] ?? 0 }))
    .sort((a, b) => b.aiScore - a.aiScore)
    .slice(0, TARGET_BRANDED_COUNT);

  console.log("🏆 Top 15 AI-selected OPD medicines:");
  console.table(ranked.slice(0, 15).map((r) => ({ name: r.name, mfg: r.manufacturer, score: r.aiScore, mrp: r.mrp })));

  // Check our real prescription brands!
  for (const term of ["sumoflam", "omnacortil", "meftal", "vertin", "telma", "l-cin"]) {
    const found = ranked.filter((r) => r.name.toLowerCase().includes(term));
    console.log(`🔎 "${term}" in top ${TARGET_BRANDED_COUNT}:`, found.slice(0, 3).map((f) => `${f.name} (score=${f.aiScore})`));
  }

  if (!process.argv.includes("--upsert")) {
    console.log("\n💡 Dry run complete! Run with --upsert to sync these medicines into Supabase.");
    return;
  }

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: existing } = await sb.from("medicines").select("brand_name");
  const existingSet = new Set((existing ?? []).map((e) => e.brand_name.toLowerCase().trim()));

  const toInsert = ranked
    .filter((r) => !existingSet.has(r.name.toLowerCase().trim()))
    .map((r) => ({
      brand_name: r.name,
      manufacturer: r.manufacturer,
      pack_size: r.packSize || "strip of 10 tablets",
      composition_display: r.compositionDisplay,
      composition_key: r.compositionKey,
      mrp: r.mrp,
      is_jan_aushadhi: false,
      is_nti: isNtiComposition(r.compositionDisplay),
      is_schedule_h: isScheduleHComposition(r.compositionDisplay),
      manually_verified: false,
    }));

  console.log(`🚀 Inserting ${toInsert.length} new AI-curated medicines into Supabase...`);
  for (let i = 0; i < toInsert.length; i += 100) {
    const { error } = await sb.from("medicines").insert(toInsert.slice(i, i + 100));
    if (error) throw error;
  }
  console.log("🎉 Supabase medicines catalog upgraded!");
}

main().catch(console.error);
