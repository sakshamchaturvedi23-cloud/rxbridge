/**
 * src/app/api/medicines/alias/route.ts
 *
 * POST /api/medicines/alias
 *
 * Auto-Learning Hook:
 * Persists patient/user confirmed OCR correction mapping (raw_ocr_text -> medicine_id)
 * into Supabase `ocr_aliases` to continuously improve handwriting OCR recognition.
 *
 * Owner: P2 (AI Extraction, Clinical Rules & Data Owner)
 * Branch: p2-ai-data
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/server";

const aliasPayloadSchema = z.object({
  raw_text: z.string().min(2, "Raw text must be at least 2 characters"),
  matched_medicine_id: z.string().uuid("Invalid matched_medicine_id UUID"),
});

export async function POST(request: NextRequest) {
  try {
    const json = await request.json();
    const parsed = aliasPayloadSchema.safeParse(json);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid payload" },
        { status: 400 }
      );
    }

    const { raw_text, matched_medicine_id } = parsed.data;
    const cleanRawText = raw_text.trim().toLowerCase();

    // Use admin client to write to ocr_aliases safely server-side
    const supabase = createAdminClient();

    // Check if the alias already exists to increment correction_count
    const { data: existing, error: checkError } = await supabase
      .from("ocr_aliases")
      .select("id, correction_count")
      .eq("raw_text", cleanRawText)
      .maybeSingle();

    if (checkError) {
      return NextResponse.json(
        { error: `Database check error: ${checkError.message}` },
        { status: 500 }
      );
    }

    if (existing) {
      const { error: updateError } = await supabase
        .from("ocr_aliases")
        .update({
          matched_medicine_id,
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
      const { error: insertError } = await supabase.from("ocr_aliases").insert({
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
