import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import OpenAI from "openai";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { buildCompositionKey } from "@/lib/clinical/normalize";
import { isNtiComposition, isScheduleHComposition } from "@/lib/clinical/nti-list";
import { findDemoPrescriptionCache, toDemoExtractResponse } from "@/lib/clinical/demo-cache";
import { findFuzzyMedicineMatches, type CandidateMedicine } from "@/lib/clinical/fuzzy-match";
import { evaluatePrescriptionSafety } from "@/lib/clinical/safety-check";
import type {
  ConfidenceLevel,
  ExtractResponse,
  ExtractedMedicineItem,
  MedicineMatchStatus,
  MedicineSuggestion,
} from "@/types/contracts";
import type { Json } from "@/types/database.types";

export const maxDuration = 60;

const extractRequestSchema = z.object({
  storage_path: z.string().min(1, "storage_path is required"),
  image_hash: z.string().optional(),
});

const ocrMedicineItemSchema = z.object({
  raw_name: z.string().default("Unknown Medicine"),
  strength: z.string().nullable().optional(),
  dosage_instructions: z.string().nullable().optional(),
  duration: z.string().nullable().optional(),
  confidence: z.enum(["high", "amber"]).catch("amber"),
});

const ocrResponseSchema = z.object({
  patient_name: z.string().nullable().optional(),
  prescription_date: z.string().nullable().optional(),
  medicines: z.array(ocrMedicineItemSchema).default([]),
});

/**
 * Checks whether the extracted prescription date is within the last 6 months.
 */
function checkDateValid(dateString: string | null | undefined): boolean | null {
  if (!dateString) return null;
  const parsedDate = new Date(dateString);
  if (isNaN(parsedDate.getTime())) return null;

  const now = new Date();
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(now.getMonth() - 6);

  const tomorrow = new Date();
  tomorrow.setDate(now.getDate() + 1);

  return parsedDate >= sixMonthsAgo && parsedDate <= tomorrow;
}

/**
 * Compares patient full name from user profile against the extracted name from prescription.
 */
function checkPatientNameMatch(
  userFullName: string | null | undefined,
  extractedName: string | null | undefined
): boolean | null {
  if (!userFullName || !extractedName) return null;

  const cleanUser = userFullName.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
  const cleanExtracted = extractedName.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
  if (!cleanUser || !cleanExtracted) return null;

  if (cleanUser === cleanExtracted) return true;

  const userTokens = cleanUser.split(/\s+/).filter(Boolean);
  const extractedTokens = cleanExtracted.split(/\s+/).filter(Boolean);

  // Consider it a match if at least one meaningful token (length >= 3) overlaps
  return extractedTokens.some(
    (token) => token.length >= 3 && userTokens.includes(token)
  );
}

/**
 * POST /api/extract
 *
 * Extracts medicines and clinical trust checks from uploaded prescription images.
 * Supports:
 * - Deterministic offline demo cache for 5 synthetic demo prescriptions.
 * - Live Vision LLM OCR via OpenAI SDK with fallback and clinical database matching.
 */
export async function POST(request: NextRequest) {
  // 1. Authenticate caller using cookie-based Supabase client
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 2. Validate request body
  const body = await request.json().catch(() => null);
  const parseResult = extractRequestSchema.safeParse(body);

  if (!parseResult.success) {
    return NextResponse.json(
      { error: "Invalid request payload", details: parseResult.error.format() },
      { status: 400 }
    );
  }

  const { storage_path, image_hash } = parseResult.data;

  // 3. Enforce private bucket ownership: path must be inside user's directory
  if (!storage_path.startsWith(`${user.id}/`)) {
    return NextResponse.json(
      { error: "Forbidden storage_path" },
      { status: 403 }
    );
  }

  // Fetch patient profile for name trust checks and clinical safety evaluation
  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, allergies, chronic_conditions, current_meds")
    .eq("id", user.id)
    .maybeSingle();

  const userFullName = profile?.full_name?.trim() || "";
  const patientSafetyProfile = {
    allergies: profile?.allergies ?? [],
    chronic_conditions: profile?.chronic_conditions ?? [],
    current_meds: profile?.current_meds ?? [],
  };

  // 4. Duplicate check against existing prescriptions for this user
  let isDuplicate = false;
  if (image_hash) {
    const { data: existingRx } = await supabase
      .from("prescriptions")
      .select("id")
      .eq("patient_id", user.id)
      .eq("image_hash", image_hash)
      .limit(1);

    if (existingRx && existingRx.length > 0) {
      isDuplicate = true;
    }
  }

  // --------------------------------------------------------------------------
  // 5. Demo Cache Path
  // --------------------------------------------------------------------------
  const matchedDemo = findDemoPrescriptionCache({ storage_path, image_hash });
  if (matchedDemo) {
    const effectiveHash = image_hash || matchedDemo.image_hash;

    // Check duplicate using demo hash if not already checked
    if (!isDuplicate && effectiveHash) {
      const { data: existingRx } = await supabase
        .from("prescriptions")
        .select("id")
        .eq("patient_id", user.id)
        .eq("image_hash", effectiveHash)
        .limit(1);

      if (existingRx && existingRx.length > 0) {
        isDuplicate = true;
      }
    }

    const patientNameMatch = checkPatientNameMatch(userFullName, matchedDemo.patient_name);
    const dateValid = checkDateValid(matchedDemo.prescription_date) ?? matchedDemo.trust_checks.date_valid;

    // Evaluate clinical safety (NTI lock, Schedule H, allergies, chronic conditions, interactions)
    const demoSafetyReport = evaluatePrescriptionSafety(
      matchedDemo.items.map((item) => ({
        temp_id: item.temp_id,
        medicine_id: item.matched_medicine_id,
        brand_name: item.brand_name,
        composition_display: item.composition_display,
        composition_key: item.composition_key,
        is_nti: item.is_nti,
        is_schedule_h: item.is_schedule_h,
      })),
      patientSafetyProfile
    );

    // Ensure all NTI items strictly keep allow_alternative: false
    const demoItems: ExtractedMedicineItem[] = matchedDemo.items.map((item, idx) => {
      const safetyEval = demoSafetyReport.items[idx];
      const isNti = Boolean(safetyEval?.is_nti || item.is_nti);
      return {
        ...item,
        is_nti: isNti,
        is_schedule_h: Boolean(safetyEval?.is_schedule_h || item.is_schedule_h),
        allow_alternative: isNti ? false : item.allow_alternative,
        safety_flags: safetyEval?.safety_flags ?? item.safety_flags,
      };
    });

    const computedTrustChecks = {
      date_valid: dateValid,
      patient_name_match: patientNameMatch,
      is_duplicate: isDuplicate,
    };

    // Persist to prescriptions table
    const { data: newPrescription, error: insertError } = await supabase
      .from("prescriptions")
      .insert({
        patient_id: user.id,
        image_url: storage_path,
        image_hash: effectiveHash,
        extracted_items: demoItems as unknown as Json,
        trust_checks: computedTrustChecks,
        confirmed_by_patient: false,
      })
      .select("id")
      .single();

    if (insertError) {
      console.warn("⚠️ Failed to persist demo prescription row:", insertError.message);
    }

    const response = toDemoExtractResponse(
      { ...matchedDemo, items: demoItems },
      newPrescription?.id || `demo-${matchedDemo.key}`
    );
    response.trust_checks = computedTrustChecks;

    return NextResponse.json(response);
  }

  // --------------------------------------------------------------------------
  // 6. Live Vision OCR Path (Non-cached)
  // --------------------------------------------------------------------------
  // Create short-lived 300s signed URL using admin client
  const adminClient = createAdminClient();
  const objectPath = storage_path.replace(/^prescriptions\//, "");

  const { data: signedData, error: signedError } = await adminClient.storage
    .from("prescriptions")
    .createSignedUrl(objectPath, 300);

  if (signedError || !signedData?.signedUrl) {
    return NextResponse.json(
      { error: `Failed to create signed URL for image: ${signedError?.message || "Storage error"}` },
      { status: 500 }
    );
  }

  // Fetch the image from the signed URL and convert to base64 data URL
  const imageResponse = await fetch(signedData.signedUrl);
  if (!imageResponse.ok) {
    return NextResponse.json(
      { error: `Failed to download image from storage: ${imageResponse.statusText}` },
      { status: 500 }
    );
  }

  const rawContentType = imageResponse.headers.get("content-type") || "image/jpeg";
  let mimeType = rawContentType.split(";")[0].trim() || "image/jpeg";
  if (!mimeType || mimeType === "application/octet-stream") {
    if (objectPath.endsWith(".png")) mimeType = "image/png";
    else if (objectPath.endsWith(".webp")) mimeType = "image/webp";
    else mimeType = "image/jpeg";
  }

  const arrayBuffer = await imageResponse.arrayBuffer();
  const base64Data = Buffer.from(arrayBuffer).toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64Data}`;

  // Call Vision LLM using OpenAI SDK
  if (!process.env.VISION_LLM_API_KEY) {
    return NextResponse.json(
      { error: "VISION_LLM_API_KEY is not configured on the server" },
      { status: 500 }
    );
  }

  const openai = new OpenAI({
    apiKey: process.env.VISION_LLM_API_KEY,
    baseURL: process.env.VISION_LLM_BASE_URL || undefined,
  });

  const systemPrompt = `You are an expert Indian clinical prescription OCR AI assistant.
Extract all prescribed medicines and clinical details from the provided prescription image.
Return a valid JSON object matching this schema:
{
  "patient_name": string | null,
  "prescription_date": string | null (in YYYY-MM-DD format if visible),
  "medicines": [
    {
      "raw_name": string (brand name or active ingredient as written on prescription),
      "strength": string | null (e.g. "500mg", "625mg", "10mg"),
      "dosage_instructions": string | null (e.g. "1 tab BD x 5 days", "OD before food"),
      "duration": string | null (e.g. "5 days", "1 month"),
      "confidence": "high" | "amber" ("amber" if handwriting is difficult, messy, ambiguous, or partially obscured)
    }
  ]
}
Do not hallucinate medicines that are not clearly visible. Always output pure JSON.`;

  const primaryModel = process.env.VISION_LLM_MODEL?.trim();
  const defaultBackupChain = [
    "gemini-3.1-flash-lite-preview",
    "gemini-flash-lite-latest",
    "gemini-3.1-flash-lite",
    "gemini-flash-lite",
  ];

  const envList = process.env.VISION_LLM_MODELS
    ? process.env.VISION_LLM_MODELS.split(",").map((m) => m.trim()).filter(Boolean)
    : [];

  const candidateModels =
    envList.length > 0
      ? Array.from(new Set(envList))
      : Array.from(new Set([...(primaryModel ? [primaryModel] : []), ...defaultBackupChain]));

  let completion: OpenAI.Chat.Completions.ChatCompletion | null = null;
  const attemptErrors: string[] = [];

  for (const candidateModel of candidateModels) {
    try {
      completion = await openai.chat.completions.create(
        {
          model: candidateModel,
          messages: [
            {
              role: "system",
              content: systemPrompt,
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "Extract all prescribed medicines, strengths, dosage instructions, prescription date, and patient name as structured JSON.",
                },
                {
                  type: "image_url",
                  image_url: {
                    url: dataUrl,
                  },
                },
              ],
            },
          ],
          response_format: { type: "json_object" },
        },
        { timeout: 15000 }
      );
      break;
    } catch (llmError) {
      const errorMsg = llmError instanceof Error ? llmError.message : "Unknown LLM error";
      attemptErrors.push(`${candidateModel}: ${errorMsg}`);
    }
  }
  if (!completion) {
    return NextResponse.json(
      {
        error: "Vision OCR extraction failed across all fallback models",
        details: attemptErrors,
      },
      { status: 502 }
    );
  }

  // Log response.model and _routed_via to server console
  console.log(
    `[OCR Model]: ${completion.model}, routed_via: ${(completion as unknown as Record<string, unknown>)._routed_via ?? "direct"}`
  );

  // Parse structured JSON response
  let rawContent = completion.choices[0]?.message?.content || "{}";
  rawContent = rawContent.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawContent);
  } catch {
    return NextResponse.json(
      { error: "Failed to parse OCR response as JSON", raw: rawContent },
      { status: 502 }
    );
  }

  const ocrData = ocrResponseSchema.parse(parsedJson);

  // Compute trust checks
  const dateValid = checkDateValid(ocrData.prescription_date);
  const patientNameMatch = checkPatientNameMatch(userFullName, ocrData.patient_name);

  // Lazy catalog cache outside the item loop: loaded at most once if needed
  let catalogCache: CandidateMedicine[] | null = null;
 async function getCatalogForFuzzy(): Promise<CandidateMedicine[]> {
    if (catalogCache !== null) return catalogCache;

    const all: CandidateMedicine[] = [];
    const pageSize = 1000;

    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabase
        .from("medicines")
        .select("id, brand_name, composition_display, composition_key, is_nti, is_schedule_h")
        .range(from, from + pageSize - 1);

      if (error) {
        console.warn("⚠️ Failed to load medicines catalog for fuzzy match:", error.message);
        break;
      }

      if (!data || data.length === 0) break;
      all.push(...(data as CandidateMedicine[]));
      if (data.length < pageSize) break;
    }

    catalogCache = all;
    return catalogCache;
  }

  // Process medicines and match against database / aliases / fuzzy matcher / clinical rules
  const items: ExtractedMedicineItem[] = [];

  for (let i = 0; i < ocrData.medicines.length; i++) {
    const medItem = ocrData.medicines[i];
    const rawText = [medItem.raw_name, medItem.strength].filter(Boolean).join(" ").trim();
    let matchedMedId: string | null = null;
    let brandName = medItem.raw_name;
    let compositionDisplay = [medItem.raw_name, medItem.strength].filter(Boolean).join(" ");
    let compositionKey = buildCompositionKey(compositionDisplay);
    let isNti = isNtiComposition(compositionDisplay);
    let isScheduleH = isScheduleHComposition(compositionDisplay);
    let matchStatus: MedicineMatchStatus = "manual_required";
    let suggestions: MedicineSuggestion[] = [];

    // 1. Check ocr_aliases for verified patient corrections (case-insensitive)
    let { data: alias } = await supabase
      .from("ocr_aliases")
      .select("matched_medicine_id, medicines(*)")
      .ilike("raw_text", rawText)
      .limit(1)
      .maybeSingle();

    if (!alias?.medicines && medItem.raw_name && medItem.raw_name.trim() !== rawText) {
      const { data: nameOnlyAlias } = await supabase
        .from("ocr_aliases")
        .select("matched_medicine_id, medicines(*)")
        .ilike("raw_text", medItem.raw_name.trim())
        .limit(1)
        .maybeSingle();
      alias = nameOnlyAlias;
    }

    if (alias?.medicines) {
      const dbMed = alias.medicines as {
        id: string;
        brand_name: string;
        composition_display: string;
        composition_key: string;
        is_nti: boolean;
        is_schedule_h: boolean;
      };
      matchedMedId = dbMed.id;
      brandName = dbMed.brand_name;
      compositionDisplay = dbMed.composition_display;
      compositionKey = dbMed.composition_key;
      isNti = dbMed.is_nti || isNtiComposition(dbMed.composition_display || dbMed.brand_name);
      isScheduleH =
        dbMed.is_schedule_h || isScheduleHComposition(dbMed.composition_display || dbMed.brand_name);
      matchStatus = "alias";
    } else {
      // 2. Query medicines catalog by brand_name
      const cleanBrandQuery = medItem.raw_name.replace(/[^a-zA-Z0-9\s-]/g, " ").trim();
      let { data: medMatches } = await supabase
        .from("medicines")
        .select("*")
        .ilike("brand_name", cleanBrandQuery)
        .limit(1);

      if (!medMatches || medMatches.length === 0) {
        const firstWord = cleanBrandQuery.split(/\s+/)[0];
        if (firstWord && firstWord.length >= 3) {
          const { data: prefixMatches } = await supabase
            .from("medicines")
            .select("*")
            .ilike("brand_name", `${firstWord}%`)
            .limit(1);
          medMatches = prefixMatches;
        }
      }

      if (medMatches && medMatches.length > 0) {
        const dbMed = medMatches[0];
        matchedMedId = dbMed.id;
        brandName = dbMed.brand_name;
        compositionDisplay = dbMed.composition_display;
        compositionKey = dbMed.composition_key;
        isNti = dbMed.is_nti || isNtiComposition(dbMed.composition_display || dbMed.brand_name);
        isScheduleH =
          dbMed.is_schedule_h || isScheduleHComposition(dbMed.composition_display || dbMed.brand_name);
        matchStatus = "exact";
      } else {
        // 3. Lazy-loaded fuzzy fallback (>= 90% auto-match, < 90% dropdown suggestions)
        const catalog = await getCatalogForFuzzy();
        const fuzzyResult = findFuzzyMedicineMatches(rawText || medItem.raw_name, catalog);
        suggestions = fuzzyResult.suggestions;
        matchStatus = fuzzyResult.status;

        if (fuzzyResult.status === "auto_matched" && fuzzyResult.matchedMedicine) {
          const fuzzyMed = fuzzyResult.matchedMedicine;
          matchedMedId = fuzzyMed.id;
          brandName = fuzzyMed.brand_name;
          compositionDisplay = fuzzyMed.composition_display;
          compositionKey = fuzzyMed.composition_key || buildCompositionKey(fuzzyMed.composition_display);
          isNti = fuzzyMed.is_nti || isNtiComposition(fuzzyMed.composition_display || fuzzyMed.brand_name);
          isScheduleH =
            fuzzyMed.is_schedule_h ||
            isScheduleHComposition(fuzzyMed.composition_display || fuzzyMed.brand_name);
        }
      }
    }

    // Strictly enforce NTI Do-Not-Substitute lock
    const allowAlternative = isNti ? false : true;

    items.push({
      temp_id: `item-${i + 1}`,
      raw_text: rawText,
      matched_medicine_id: matchedMedId,
      brand_name: brandName,
      composition_key: compositionKey || null,
      composition_display: compositionDisplay || null,
      dose: medItem.dosage_instructions || null,
      duration: medItem.duration || null,
      confidence: medItem.confidence as ConfidenceLevel,
      is_nti: isNti,
      is_schedule_h: isScheduleH,
      allow_alternative: allowAlternative,
      safety_flags: [],
      match_status: matchStatus,
      suggestions,
    });
  }

  // Evaluate clinical safety across all extracted items (NTI, Schedule H, allergies, conditions, interactions)
  const safetyReport = evaluatePrescriptionSafety(
    items.map((item) => ({
      temp_id: item.temp_id,
      medicine_id: item.matched_medicine_id,
      brand_name: item.brand_name,
      composition_display: item.composition_display,
      composition_key: item.composition_key,
      is_nti: item.is_nti,
      is_schedule_h: item.is_schedule_h,
    })),
    patientSafetyProfile
  );

  for (let i = 0; i < items.length; i++) {
    const evalResult = safetyReport.items[i];
    if (evalResult) {
      items[i].is_nti = evalResult.is_nti;
      items[i].is_schedule_h = evalResult.is_schedule_h;
      items[i].allow_alternative = evalResult.is_nti ? false : items[i].allow_alternative;
      items[i].safety_flags = evalResult.safety_flags;
    }
  }

  const trustChecks = {
    date_valid: dateValid,
    patient_name_match: patientNameMatch,
    is_duplicate: isDuplicate,
  };

  // Insert row into prescriptions table
  const { data: newPrescription, error: insertError } = await supabase
    .from("prescriptions")
    .insert({
      patient_id: user.id,
      image_url: storage_path,
      image_hash: image_hash || null,
      extracted_items: items as unknown as Json,
      trust_checks: trustChecks,
      confirmed_by_patient: false,
    })
    .select("id")
    .single();

  if (insertError || !newPrescription) {
    return NextResponse.json(
      { error: `Failed to save prescription: ${insertError?.message || "Insert error"}` },
      { status: 500 }
    );
  }

  const response: ExtractResponse = {
    prescription_id: newPrescription.id,
    from_demo_cache: false,
    items,
    trust_checks: trustChecks,
  };

  return NextResponse.json(response);
}
