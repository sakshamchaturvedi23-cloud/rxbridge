/**
 * src/lib/pharmacist/prescription-handlers.ts
 *
 * Testable handlers for Phase 6 Part B: Prescription Verification Queue,
 * Clinical Safety Review, Authorized Document Signed-URL Access & Decision Recording.
 *
 * Strictly preserves original `prescriptions` immutability and enforces
 * `owner` / `licensed_pharmacist` sign-off role + NTI non-substitution locks.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { isNtiComposition, isScheduleHComposition } from "@/lib/clinical/nti-list";
import {
  CLINICAL_DISCLAIMERS,
  evaluatePrescriptionSafety,
  type SafetyMedicineInput,
} from "@/lib/clinical/safety-check";
import { requirePharmacistContext } from "@/lib/pharmacist/auth";
import type { ContextResolver } from "@/lib/pharmacist/onboarding-handlers";
import {
  assertNoNtiSubstitution,
  assertValidVerificationTransition,
  canRoleSignOffVerification,
  mapVerificationToLegacyStatus,
  StateTransitionError,
} from "@/lib/pharmacist/state-machines";
import { createAdminClient } from "@/lib/supabase/server";
import type { ExtractedMedicineItem } from "@/types/contracts";
import type { Json } from "@/types/database.types";
import {
  PRESCRIPTION_VERIFICATION_STATUSES,
  prescriptionVerifyActionSchema,
  type PrescriptionVerificationItemDecision,
  type PrescriptionVerificationStatus,
  type VerificationNoteDTO,
} from "@/types/pharmacist";

const uuidSchema = z.string().uuid("Invalid prescription ID");

type RawExtractedItem = Partial<ExtractedMedicineItem> & {
  brand_name?: string;
  raw_text?: string;
  strength?: string | null;
  dosage_form?: string | null;
};

function parseExtractedItems(raw: unknown): RawExtractedItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (entry): entry is RawExtractedItem =>
      Boolean(entry) && typeof entry === "object"
  );
}

function summarizeExtractedItems(items: RawExtractedItem[]) {
  let hasNti = false;
  let hasScheduleH = false;
  let amberConfidenceCount = 0;

  for (const item of items) {
    const compText = item.composition_display || item.composition_key || "";
    const brand = item.brand_name || item.raw_text || "";
    const isNti =
      Boolean(item.is_nti) || isNtiComposition(compText) || isNtiComposition(brand);
    const isScheduleH =
      Boolean(item.is_schedule_h) || isNti || isScheduleHComposition(compText);
    if (isNti) hasNti = true;
    if (isScheduleH) hasScheduleH = true;
    if (item.confidence === "amber") amberConfidenceCount++;
  }

  return {
    itemCount: items.length,
    hasNti,
    hasScheduleH,
    amberConfidenceCount,
  };
}

/**
 * Verifies that `prescriptionId` is legitimately linked to `shopId` via either
 * `prescription_verifications` or an assigned `reservations` row.
 */
async function resolveShopPrescriptionLink(
  ctx: Extract<Awaited<ReturnType<ContextResolver>>, { ok: true }>,
  prescriptionId: string
) {
  const [verifRes, resRes] = await Promise.all([
    ctx.supabase
      .from("prescription_verifications")
      .select("*")
      .eq("prescription_id", prescriptionId)
      .eq("shop_id", ctx.shopId)
      .maybeSingle(),
    ctx.supabase
      .from("reservations")
      .select("id, fulfilment_status, order_status, verification_status, created_at")
      .eq("prescription_id", prescriptionId)
      .eq("shop_id", ctx.shopId)
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  if (verifRes.error) {
    return { ok: false as const, status: 500 as const, error: verifRes.error.message };
  }
  if (resRes.error) {
    return { ok: false as const, status: 500 as const, error: resRes.error.message };
  }

  const verification = verifRes.data ?? null;
  const reservation = resRes.data?.[0] ?? null;

  if (!verification && !reservation) {
    return {
      ok: false as const,
      status: 403 as const,
      error: "Forbidden: prescription is not assigned to your pharmacy.",
    };
  }

  return {
    ok: true as const,
    verification,
    reservation,
  };
}

/**
 * GET /api/pharmacist/prescriptions
 */
export async function handleListPrescriptions(
  searchParams: URLSearchParams,
  resolveContext: ContextResolver = requirePharmacistContext
): Promise<NextResponse> {
  const ctx = await resolveContext();
  if (!ctx.ok) {
    return NextResponse.json(
      { error: ctx.error, code: ctx.code },
      { status: ctx.status }
    );
  }

  const statusFilter = (searchParams.get("status") ?? "all").trim();
  const search = (searchParams.get("search") ?? "").trim().toLowerCase();

  let query = ctx.supabase
    .from("prescription_verifications")
    .select(
      "*, prescriptions(id, extracted_items, trust_checks, confirmed_by_patient, created_at), reservations(id, fulfilment_status, order_status, verification_status, created_at)"
    )
    .eq("shop_id", ctx.shopId)
    .order("created_at", { ascending: false });

  if (
    statusFilter !== "all" &&
    (PRESCRIPTION_VERIFICATION_STATUSES as readonly string[]).includes(statusFilter)
  ) {
    query = query.eq("status", statusFilter);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: `Failed to fetch prescription queue: ${error.message}` },
      { status: 500 }
    );
  }

  const mapped = (data ?? []).map((row) => {
    const rx = row.prescriptions as {
      id: string;
      extracted_items: Json;
      trust_checks: Json;
      confirmed_by_patient: boolean;
      created_at: string | null;
    } | null;

    const linkedRes = row.reservations as {
      id: string;
      fulfilment_status: string;
      order_status: string;
      verification_status: string;
      created_at: string | null;
    } | null;

    const extracted = parseExtractedItems(rx?.extracted_items);
    const summary = summarizeExtractedItems(extracted);

    return {
      id: row.id,
      prescription_id: row.prescription_id,
      shop_id: row.shop_id,
      reservation_id: row.reservation_id,
      status: row.status as PrescriptionVerificationStatus,
      decision_reason: row.decision_reason,
      verified_by: row.verified_by,
      verified_at: row.verified_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      confirmed_by_patient: rx?.confirmed_by_patient ?? false,
      trust_checks: rx?.trust_checks ?? {},
      reservation: linkedRes,
      medicine_preview: extracted
        .slice(0, 4)
        .map((m) => m.brand_name || m.raw_text || "Unknown"),
      ...summary,
    };
  });

  const filtered = search
    ? mapped.filter((item) => {
        const haystack = [
          item.prescription_id,
          item.reservation_id,
          ...item.medicine_preview,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(search);
      })
    : mapped;

  return NextResponse.json({
    items: filtered,
    canSignOff: canRoleSignOffVerification(ctx.memberRole),
  });
}

/**
 * GET /api/pharmacist/prescriptions/[id]
 */
export async function handleGetPrescriptionDetail(
  prescriptionId: string,
  resolveContext: ContextResolver = requirePharmacistContext
): Promise<NextResponse> {
  const ctx = await resolveContext();
  if (!ctx.ok) {
    return NextResponse.json(
      { error: ctx.error, code: ctx.code },
      { status: ctx.status }
    );
  }

  const idParse = uuidSchema.safeParse(prescriptionId);
  if (!idParse.success) {
    return NextResponse.json(
      { error: "Invalid prescription ID format" },
      { status: 400 }
    );
  }

  const link = await resolveShopPrescriptionLink(ctx, idParse.data);
  if (!link.ok) {
    return NextResponse.json({ error: link.error }, { status: link.status });
  }

  const [rxRes, notesRes] = await Promise.all([
    ctx.supabase
      .from("prescriptions")
      .select("id, image_url, extracted_items, trust_checks, confirmed_by_patient, created_at")
      .eq("id", idParse.data)
      .maybeSingle(),
    link.verification
      ? ctx.supabase
          .from("pharmacist_verification_notes")
          .select("*")
          .eq("verification_id", link.verification.id)
          .eq("shop_id", ctx.shopId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (rxRes.error) {
    return NextResponse.json(
      { error: `Failed to fetch prescription: ${rxRes.error.message}` },
      { status: 500 }
    );
  }
  if (!rxRes.data) {
    return NextResponse.json(
      { error: "Prescription record not found" },
      { status: 404 }
    );
  }
  if (notesRes.error) {
    return NextResponse.json(
      { error: `Failed to fetch verification notes: ${notesRes.error.message}` },
      { status: 500 }
    );
  }

  const extractedItems = parseExtractedItems(rxRes.data.extracted_items);
  const safetyInputs: SafetyMedicineInput[] = extractedItems.map((item, idx) => ({
    temp_id: item.temp_id || `item-${idx + 1}`,
    medicine_id: item.matched_medicine_id ?? null,
    brand_name: item.brand_name || item.raw_text || `Medicine ${idx + 1}`,
    composition_display: item.composition_display ?? null,
    composition_key: item.composition_key ?? null,
    is_nti: item.is_nti,
    is_schedule_h: item.is_schedule_h,
  }));

  // Evaluate clinical safety (NTI locks, Schedule H, intra-prescription interactions)
  const safetyReport = evaluatePrescriptionSafety(safetyInputs, {});

  return NextResponse.json({
    verification: link.verification,
    reservation: link.reservation,
    prescription: {
      id: rxRes.data.id,
      confirmed_by_patient: rxRes.data.confirmed_by_patient,
      trust_checks: rxRes.data.trust_checks,
      created_at: rxRes.data.created_at,
      has_document: Boolean(rxRes.data.image_url),
      extracted_items: extractedItems,
    },
    safety_report: safetyReport,
    disclaimers: CLINICAL_DISCLAIMERS,
    notes: (notesRes.data ?? []) as VerificationNoteDTO[],
    canSignOff: canRoleSignOffVerification(ctx.memberRole),
    memberRole: ctx.memberRole,
  });
}

/**
 * GET /api/pharmacist/prescriptions/[id]/document
 * Generates a short-lived 300s signed URL via server-only createAdminClient()
 * after verifying shop authorization. Never weakens storage.objects policies.
 */
export async function handleGetPrescriptionDocument(
  prescriptionId: string,
  resolveContext: ContextResolver = requirePharmacistContext,
  getAdminClient = createAdminClient
): Promise<NextResponse> {
  const ctx = await resolveContext();
  if (!ctx.ok) {
    return NextResponse.json(
      { error: ctx.error, code: ctx.code },
      { status: ctx.status }
    );
  }

  const idParse = uuidSchema.safeParse(prescriptionId);
  if (!idParse.success) {
    return NextResponse.json(
      { error: "Invalid prescription ID format" },
      { status: 400 }
    );
  }

  const link = await resolveShopPrescriptionLink(ctx, idParse.data);
  if (!link.ok) {
    return NextResponse.json({ error: link.error }, { status: link.status });
  }

  // Also block viewing document if only linked reservation was cancelled/expired and no verification exists
  if (
    !link.verification &&
    link.reservation &&
    ["cancelled", "expired"].includes(link.reservation.fulfilment_status)
  ) {
    return NextResponse.json(
      { error: "Forbidden: linked reservation is no longer active." },
      { status: 403 }
    );
  }

  const { data: rxRow, error: rxErr } = await ctx.supabase
    .from("prescriptions")
    .select("id, image_url")
    .eq("id", idParse.data)
    .maybeSingle();

  if (rxErr) {
    return NextResponse.json(
      { error: `Failed to fetch prescription document reference: ${rxErr.message}` },
      { status: 500 }
    );
  }
  if (!rxRow) {
    return NextResponse.json(
      { error: "Prescription not found" },
      { status: 404 }
    );
  }
  if (!rxRow.image_url?.trim()) {
    return NextResponse.json(
      { error: "No uploaded prescription document is attached." },
      { status: 404 }
    );
  }

  const objectPath = rxRow.image_url.trim().replace(/^prescriptions\//, "");
  const adminClient = getAdminClient();

  const { data: signedData, error: signedErr } = await adminClient.storage
    .from("prescriptions")
    .createSignedUrl(objectPath, 300);

  if (signedErr || !signedData?.signedUrl) {
    return NextResponse.json(
      {
        error: `Failed to generate short-lived signed URL: ${signedErr?.message || "Storage error"}`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    signedUrl: signedData.signedUrl,
    expiresInSeconds: 300,
  });
}

/**
 * POST /api/pharmacist/prescriptions/[id]/verify
 */
export async function handleVerifyPrescription(
  prescriptionId: string,
  rawBody: unknown,
  resolveContext: ContextResolver = requirePharmacistContext
): Promise<NextResponse> {
  const ctx = await resolveContext({
    requiredRoles: ["owner", "licensed_pharmacist"],
  });
  if (!ctx.ok) {
    return NextResponse.json(
      { error: ctx.error, code: ctx.code },
      { status: ctx.status }
    );
  }

  const idParse = uuidSchema.safeParse(prescriptionId);
  if (!idParse.success) {
    return NextResponse.json(
      { error: "Invalid prescription ID format" },
      { status: 400 }
    );
  }

  const parsed = prescriptionVerifyActionSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid verification payload", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const link = await resolveShopPrescriptionLink(ctx, idParse.data);
  if (!link.ok) {
    return NextResponse.json({ error: link.error }, { status: link.status });
  }

  const currentStatus: PrescriptionVerificationStatus =
    (link.verification?.status as PrescriptionVerificationStatus) ??
    "pending_review";
  const targetStatus: PrescriptionVerificationStatus = parsed.data.decision;
  const noteText = parsed.data.note?.trim() ?? "";

  try {
    assertValidVerificationTransition({
      from: currentStatus,
      to: targetStatus,
      memberRole: ctx.memberRole,
      reason: noteText,
    });
  } catch (err) {
    if (err instanceof StateTransitionError) {
      const statusCode =
        err.code === "UNAUTHORIZED_ROLE"
          ? 403
          : err.code === "REASON_REQUIRED"
            ? 400
            : 409;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: statusCode }
      );
    }
    throw err;
  }

  // Load read-only prescription items for clinical integrity & NTI checks
  const { data: rxRow, error: rxErr } = await ctx.supabase
    .from("prescriptions")
    .select("id, extracted_items")
    .eq("id", idParse.data)
    .maybeSingle();

  if (rxErr || !rxRow) {
    return NextResponse.json(
      { error: rxErr?.message || "Prescription not found" },
      { status: rxErr ? 500 : 404 }
    );
  }

  const extractedItems = parseExtractedItems(rxRow.extracted_items);

  // Enforce NTI non-substitution & prevent silent changes to medicine identity/strength/form
  const normalizedItemDecisions: PrescriptionVerificationItemDecision[] = [];

  for (const itemDec of parsed.data.item_decisions) {
    const matchedPrescribed = extractedItems.find((orig) => {
      if (itemDec.temp_id && orig.temp_id === itemDec.temp_id) return true;
      if (itemDec.medicine_id && orig.matched_medicine_id === itemDec.medicine_id)
        return true;
      const origBrand = (orig.brand_name || orig.raw_text || "").trim().toLowerCase();
      return origBrand && origBrand === itemDec.medicine_name.trim().toLowerCase();
    });

    if (!matchedPrescribed && extractedItems.length > 0) {
      return NextResponse.json(
        {
          error: `Clinical integrity check failed: '${itemDec.medicine_name}' does not match any prescribed item on the original prescription.`,
          code: "CLINICAL_IDENTITY_MISMATCH",
        },
        { status: 422 }
      );
    }

    const prescribedSnapshot = matchedPrescribed
      ? {
          temp_id: matchedPrescribed.temp_id,
          matched_medicine_id: matchedPrescribed.matched_medicine_id ?? null,
          brand_name:
            matchedPrescribed.brand_name ||
            matchedPrescribed.raw_text ||
            itemDec.medicine_name,
          composition_display: matchedPrescribed.composition_display ?? null,
          composition_key: matchedPrescribed.composition_key ?? null,
          strength: matchedPrescribed.strength ?? null,
          dosage_form: matchedPrescribed.dosage_form ?? null,
          is_nti: matchedPrescribed.is_nti,
        }
      : {
          brand_name: itemDec.medicine_name,
          matched_medicine_id: itemDec.medicine_id ?? null,
        };

    const proposedDecision: PrescriptionVerificationItemDecision["decision"] =
      itemDec.clarification_needed
        ? "needs_clarification"
        : itemDec.verified
          ? "approved"
          : "rejected";

    try {
      assertNoNtiSubstitution(prescribedSnapshot, {
        decision: proposedDecision,
        allow_substitution: itemDec.allow_substitution,
        suggested_medicine_id: itemDec.suggested_medicine_id,
        suggested_brand_name: itemDec.suggested_brand_name,
        suggested_composition_display: itemDec.suggested_composition_display,
        suggested_strength: itemDec.suggested_strength,
        suggested_dosage_form: itemDec.suggested_dosage_form,
        note: itemDec.note,
      });
    } catch (err) {
      if (err instanceof StateTransitionError) {
        return NextResponse.json(
          { error: err.message, code: err.code },
          { status: 422 }
        );
      }
      throw err;
    }

    normalizedItemDecisions.push({
      temp_id: itemDec.temp_id || prescribedSnapshot.temp_id || itemDec.medicine_name,
      medicine_id: prescribedSnapshot.matched_medicine_id ?? null,
      brand_name: prescribedSnapshot.brand_name,
      decision: proposedDecision,
      suggested_medicine_id: itemDec.suggested_medicine_id ?? null,
      suggested_brand_name: itemDec.suggested_brand_name ?? null,
      note: itemDec.note ?? null,
    });
  }

  const nowIso = new Date().toISOString();
  let savedVerification = link.verification;

  if (savedVerification) {
    const { data: updated, error: updateErr } = await ctx.supabase
      .from("prescription_verifications")
      .update({
        status: targetStatus,
        decision_reason: noteText || null,
        verified_by: ctx.user.id,
        verified_at: nowIso,
        item_decisions: normalizedItemDecisions as unknown as Json,
        updated_at: nowIso,
      })
      .eq("id", savedVerification.id)
      .eq("shop_id", ctx.shopId)
      .select("*")
      .single();

    if (updateErr || !updated) {
      return NextResponse.json(
        {
          error: `Failed to update prescription verification: ${updateErr?.message || "Update error"}`,
        },
        { status: 500 }
      );
    }
    savedVerification = updated;
  } else {
    const { data: inserted, error: insertErr } = await ctx.supabase
      .from("prescription_verifications")
      .insert({
        prescription_id: idParse.data,
        shop_id: ctx.shopId,
        reservation_id: link.reservation?.id ?? null,
        status: targetStatus,
        decision_reason: noteText || null,
        verified_by: ctx.user.id,
        verified_at: nowIso,
        item_decisions: normalizedItemDecisions as unknown as Json,
      })
      .select("*")
      .single();

    if (insertErr || !inserted) {
      return NextResponse.json(
        {
          error: `Failed to save prescription verification: ${insertErr?.message || "Insert error"}`,
        },
        { status: 500 }
      );
    }
    savedVerification = inserted;
  }

  // Append immutable audit note
  const auditNoteBody =
    noteText || `Verification recorded as '${targetStatus}'`;

  const { data: createdNote, error: noteErr } = await ctx.supabase
    .from("pharmacist_verification_notes")
    .insert({
      verification_id: savedVerification.id,
      prescription_id: idParse.data,
      shop_id: ctx.shopId,
      author_id: ctx.user.id,
      decision_snapshot: targetStatus,
      note: auditNoteBody,
    })
    .select("*")
    .single();

  if (noteErr) {
    console.warn(
      `[pharmacist-verify] Audit note insert warning for ${savedVerification.id}:`,
      noteErr.message
    );
  }

  // Sync legacy reservations.verification_status if linked
  const linkedReservationId =
    savedVerification.reservation_id ?? link.reservation?.id ?? null;
  if (linkedReservationId) {
    await ctx.supabase
      .from("reservations")
      .update({
        verification_status: mapVerificationToLegacyStatus(targetStatus),
        updated_at: nowIso,
      })
      .eq("id", linkedReservationId)
      .eq("shop_id", ctx.shopId);
  }

  return NextResponse.json({
    verification: savedVerification,
    note: createdNote ?? null,
  });
}
