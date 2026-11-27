/**
 * src/app/api/medicines/alias/route.ts
 *
 * POST /api/medicines/alias
 *
 * Auto-Learning Hook:
 * Persists authenticated user OCR correction mappings (raw_ocr_text -> medicine_id)
 * into Supabase `ocr_aliases` to continuously improve handwriting OCR recognition.
 *
 * Security & Integrity:
 * - Requires authenticated session via `createClient()` (`supabase.auth.getUser()`).
 * - Verifies `matched_medicine_id` exists in `medicines`.
 * - Normalizes `raw_text` and refuses conflicting overwrites (returns 409 Conflict)
 *   if `raw_text` is already mapped to a different `matched_medicine_id`.
 *
 * Owner: P2 (AI Extraction, Clinical Rules & Data Owner)
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { normalizeAliasRawText } from "@/lib/clinical/alias-learning";

const aliasPayloadSchema = z.object({
  raw_text: z.string().trim().min(2, "Raw text must be at least 2 characters").max(160),
  matched_medicine_id: z.string().uuid("Invalid matched_medicine_id UUID"),
});

export async function POST(request: NextRequest) {
  try {
    // 1. Authenticate caller via cookie-based Supabase client
    const userClient = await createClient();
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Validate payload
    const json = await request.json().catch(() => null);
    const parsed = aliasPayloadSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid payload" },
        { status: 400 }
      );
    }

    const { raw_text, matched_medicine_id } = parsed.data;
    const cleanRawText = normalizeAliasRawText(raw_text);

    if (cleanRawText.length < 2) {
      return NextResponse.json(
        { error: "Normalized raw_text must be at least 2 characters" },
        { status: 400 }
      );
    }

    // 3. Verify target medicine exists (using authenticated RLS client)
    const { data: targetMedicine, error: medError } = await userClient
      .from("medicines")
      .select("id, brand_name")
      .eq("id", matched_medicine_id)
      .maybeSingle();

    if (medError) {
      return NextResponse.json(
        { error: `Failed to verify target medicine: ${medError.message}` },
        { status: 500 }
      );
    }

    if (!targetMedicine) {
      return NextResponse.json(
        { error: "Target medicine not found for matched_medicine_id" },
        { status: 404 }
      );
    }

    // 4. Use admin client strictly for authorized server-side write to `ocr_aliases`
    const adminSupabase = createAdminClient();

    const { data: existing, error: checkError } = await adminSupabase
      .from("ocr_aliases")
      .select("id, matched_medicine_id, correction_count")
      .eq("raw_text", cleanRawText)
      .maybeSingle();

    if (checkError) {
      return NextResponse.json(
        { error: `Database check error: ${checkError.message}` },
        { status: 500 }
      );
    }

    if (existing) {
      // Guard against conflicting overwrites of an existing alias mapping
      if (existing.matched_medicine_id !== matched_medicine_id) {
        return NextResponse.json(
          {
            error: "Conflicting OCR alias already mapped to a different medicine",
            conflict: true,
            raw_text: cleanRawText,
            existing_medicine_id: existing.matched_medicine_id,
          },
          { status: 409 }
        );
      }

      const { error: updateError } = await adminSupabase
        .from("ocr_aliases")
        .update({
          correction_count: (existing.correction_count || 1) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);

      if (updateError) {
        return NextResponse.json(
          { error: `Failed to update alias: ${updateError.message}` },
          { status: 500 }
        );
      }
    } else {
      const { error: insertError } = await adminSupabase.from("ocr_aliases").insert({
        raw_text: cleanRawText,
        matched_medicine_id,
        correction_count: 1,
        updated_at: new Date().toISOString(),
      });

      if (insertError) {
        return NextResponse.json(
          { error: `Failed to insert alias: ${insertError.message}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      raw_text: cleanRawText,
      matched_medicine_id,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Internal alias error";
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
