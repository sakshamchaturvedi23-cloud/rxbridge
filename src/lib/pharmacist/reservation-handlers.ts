/**
 * src/lib/pharmacist/reservation-handlers.ts
 *
 * Testable handlers for Phase 7:
 * 1. Patient-side Reservation Creation & Read Bridge (/api/reservations, /api/reservations/[id])
 * 2. Pharmacist Reservations Queue & Fulfilment State Machine (/api/pharmacist/reservations, .../transition)
 *
 * Enforces:
 * - Separate clinical verification vs fulfilment state machines
 * - Schedule H / Rx verification gate before approving/preparing/fulfilling Rx items
 * - Atomic & idempotent stock holds, releases, and deductions via Postgres FOR UPDATE RPCs
 * - Full reservation_status_history audit trail & database-backed notifications
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { isNtiComposition, isScheduleHComposition } from "@/lib/clinical/nti-list";
import { requirePharmacistContext } from "@/lib/pharmacist/auth";
import {
  calculateAvailableToPromise,
  deriveInventoryStatus,
  isInventoryExpired,
} from "@/lib/pharmacist/inventory-service";
import {
  createPharmacistNotification,
} from "@/lib/pharmacist/notifications";
import type { ContextResolver } from "@/lib/pharmacist/onboarding-handlers";
import {
  assertValidReservationTransition,
  mapFulfilmentToLegacyOrderStatus,
  StateTransitionError,
} from "@/lib/pharmacist/state-machines";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import type { ReservationItemStatus, VerificationStatus } from "@/types/contracts";
import type { Json } from "@/types/database.types";
import {
  FULFILMENT_STATUSES,
  patientCreateReservationSchema,
  reservationTransitionSchema,
  type FulfilmentStatus,
  type LegacyOrderStatus,
  type PrescriptionVerificationStatus,
} from "@/types/pharmacist";

const uuidSchema = z.string().uuid("Invalid reservation ID");

const SCHEDULE_H_GATED_STATUSES = new Set<FulfilmentStatus>([
  "approved",
  "partially_approved",
  "preparing",
  "ready_for_pickup",
  "fulfilled",
]);

const RESERVED_STOCK_STATES = new Set<FulfilmentStatus>([
  "approved",
  "partially_approved",
  "preparing",
  "ready_for_pickup",
]);

const RELEASE_TARGET_STATES = new Set<FulfilmentStatus>([
  "cancelled",
  "rejected",
  "expired",
]);

// ---------------------------------------------------------------------------
// 1. Patient-Side Bridge: POST /api/reservations & GET /api/reservations/[id]
// ---------------------------------------------------------------------------

export async function handleCreatePatientReservation(
  rawBody: unknown,
  getSupabaseClient = createClient,
  getAdminClient = createAdminClient,
  emitNotification = createPharmacistNotification
): Promise<NextResponse> {
  const supabase = await getSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = patientCreateReservationSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid reservation request", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const input = parsed.data;

  // Verify shop exists and is verified
  const { data: shop, error: shopErr } = await supabase
    .from("shops")
    .select("id, name, verification_status")
    .eq("id", input.shop_id)
    .maybeSingle();

  if (shopErr) {
    return NextResponse.json(
      { error: `Failed to verify pharmacy: ${shopErr.message}` },
      { status: 500 }
    );
  }
  if (!shop) {
    return NextResponse.json({ error: "Pharmacy not found" }, { status: 404 });
  }
  if (shop.verification_status !== "verified") {
    return NextResponse.json(
      {
        error: `Selected pharmacy is '${shop.verification_status}' and cannot accept reservations.`,
      },
      { status: 403 }
    );
  }

  // Verify prescription ownership if prescription_id provided
  if (input.prescription_id) {
    const { data: rx, error: rxErr } = await supabase
      .from("prescriptions")
      .select("id, patient_id")
      .eq("id", input.prescription_id)
      .maybeSingle();

    if (rxErr) {
      return NextResponse.json(
        { error: `Failed to verify prescription: ${rxErr.message}` },
        { status: 500 }
      );
    }
    if (!rx || rx.patient_id !== user.id) {
      return NextResponse.json(
        { error: "Prescription not found or not owned by authenticated patient" },
        { status: rx ? 403 : 404 }
      );
    }
  }

  // Load requested medicines and shop inventory for pricing & NTI enforcement
  const medIds = Array.from(
    new Set(input.items.map((i) => i.requested_medicine_id))
  );

  const [medsRes, invRes] = await Promise.all([
    supabase
      .from("medicines")
      .select(
        "id, brand_name, composition_display, mrp, is_nti, is_schedule_h"
      )
      .in("id", medIds),
    supabase
      .from("shop_inventory")
      .select("id, medicine_id, selling_price, mrp, discount_pct, is_archived")
      .eq("shop_id", input.shop_id)
      .eq("is_archived", false)
      .in("medicine_id", medIds),
  ]);

  if (medsRes.error) {
    return NextResponse.json(
      { error: `Failed to load medicines: ${medsRes.error.message}` },
      { status: 500 }
    );
  }

  const medById = new Map((medsRes.data ?? []).map((m) => [m.id, m]));
  const invByMedId = new Map(
    (invRes.data ?? [])
      .filter((i) => i.medicine_id)
      .map((i) => [i.medicine_id as string, i])
  );

  for (const item of input.items) {
    if (!medById.has(item.requested_medicine_id)) {
      return NextResponse.json(
        { error: `Medicine ${item.requested_medicine_id} not found in catalog` },
        { status: 400 }
      );
    }
  }

  let estimatedTotal = 0;
  const preparedItems = input.items.map((item) => {
    const med = medById.get(item.requested_medicine_id)!;
    const inv = invByMedId.get(item.requested_medicine_id);
    const isNti =
      med.is_nti || isNtiComposition(med.composition_display || med.brand_name);

    const unitPrice =
      inv?.selling_price ??
      (inv
        ? Number(((inv.mrp ?? med.mrp) * (1 - (inv.discount_pct ?? 0) / 100)).toFixed(2))
        : med.mrp);
    estimatedTotal += unitPrice * item.quantity;

    return {
      requested_medicine_id: item.requested_medicine_id,
      inventory_id: inv?.id ?? null,
      allow_alternative: isNti ? false : item.allow_alternative,
      requested_qty: item.quantity,
      unit_price: unitPrice,
    };
  });

  const { data: createdReservation, error: resErr } = await supabase
    .from("reservations")
    .insert({
      patient_id: user.id,
      shop_id: input.shop_id,
      prescription_id: input.prescription_id ?? null,
      plan_mode: input.plan_mode,
      verification_status: "pending",
      order_status: "pending",
      fulfilment_status: "pending",
      estimated_total: Number(estimatedTotal.toFixed(2)),
    })
    .select("*")
    .single();

  if (resErr || !createdReservation) {
    return NextResponse.json(
      { error: `Failed to create reservation: ${resErr?.message || "Insert error"}` },
      { status: 500 }
    );
  }

  const { data: createdItems, error: itemsErr } = await supabase
    .from("reservation_items")
    .insert(
      preparedItems.map((it) => ({
        reservation_id: createdReservation.id,
        requested_medicine_id: it.requested_medicine_id,
        inventory_id: it.inventory_id,
        allow_alternative: it.allow_alternative,
        item_status: "pending",
        requested_qty: it.requested_qty,
        approved_qty: 0,
        stock_reserved_qty: 0,
        stock_deducted: false,
      }))
    )
    .select("*");

  if (itemsErr) {
    return NextResponse.json(
      { error: `Failed to create reservation items: ${itemsErr.message}` },
      { status: 500 }
    );
  }

  // Server-side admin operations for audit history & prescription verification queue entry
  try {
    const adminClient = getAdminClient();

    await adminClient.from("reservation_status_history").insert({
      reservation_id: createdReservation.id,
      shop_id: input.shop_id,
      from_status: null,
      to_status: "pending",
      actor_id: user.id,
      actor_role: "patient",
      reason: "Reservation submitted by patient",
    });

    if (input.prescription_id) {
      await adminClient.from("prescription_verifications").upsert(
        {
          prescription_id: input.prescription_id,
          shop_id: input.shop_id,
          reservation_id: createdReservation.id,
          status: "pending_review",
        },
        { onConflict: "prescription_id,shop_id" }
      );

      await emitNotification({
        shopId: input.shop_id,
        eventType: "prescription_review",
        title: "Prescription verification required",
        body: `Reservation #${createdReservation.id.slice(0, 8)} includes a prescription awaiting clinical verification.`,
        entityType: "prescription",
        entityId: input.prescription_id,
      });
    }
  } catch (bridgeErr) {
    console.warn("[reservations] Bridge audit/queue insert warning:", bridgeErr);
  }

  await emitNotification({
    shopId: input.shop_id,
    eventType: "reservation_received",
    title: "New reservation received",
    body: `Reservation #${createdReservation.id.slice(0, 8)} (${preparedItems.length} item(s), est. ₹${createdReservation.estimated_total}).`,
    entityType: "reservation",
    entityId: createdReservation.id,
  });

  return NextResponse.json(
    {
      reservation: createdReservation,
      items: createdItems ?? [],
    },
    { status: 201 }
  );
}

export async function handleGetPatientReservation(
  reservationId: string,
  getSupabaseClient = createClient
): Promise<NextResponse> {
  const supabase = await getSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const idParse = uuidSchema.safeParse(reservationId);
  if (!idParse.success) {
    return NextResponse.json(
      { error: "Invalid reservation ID format" },
      { status: 400 }
    );
  }

  const { data: reservation, error: resErr } = await supabase
    .from("reservations")
    .select("*")
    .eq("id", idParse.data)
    .maybeSingle();

  if (resErr) {
    return NextResponse.json(
      { error: `Failed to fetch reservation: ${resErr.message}` },
      { status: 500 }
    );
  }
  if (!reservation) {
    return NextResponse.json(
      { error: "Reservation not found" },
      { status: 404 }
    );
  }
  if (reservation.patient_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [itemsRes, historyRes] = await Promise.all([
    supabase
      .from("reservation_items")
      .select("*, medicines(id, brand_name, composition_display, is_nti, is_schedule_h)")
      .eq("reservation_id", reservation.id),
    supabase
      .from("reservation_status_history")
      .select("*")
      .eq("reservation_id", reservation.id)
      .order("created_at", { ascending: false }),
  ]);

  return NextResponse.json({
    reservation,
    items: itemsRes.data ?? [],
    status_history: historyRes.data ?? [],
  });
}

// ---------------------------------------------------------------------------
// 2. Pharmacist Reservations Queue: GET /api/pharmacist/reservations
// ---------------------------------------------------------------------------

export async function handleListPharmacistReservations(
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
    .from("reservations")
    .select(
      "*, reservation_items(*, medicines(id, brand_name, composition_display, is_nti, is_schedule_h, mrp), shop_inventory(id, quantity_on_hand, quantity_reserved, min_stock_threshold, is_available, is_archived, expiry_date, selling_price, mrp)), reservation_status_history(*)"
    )
    .eq("shop_id", ctx.shopId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (
    statusFilter !== "all" &&
    (FULFILMENT_STATUSES as readonly string[]).includes(statusFilter)
  ) {
    query = query.eq("fulfilment_status", statusFilter);
  }

  const [resResult, verifResult] = await Promise.all([
    query,
    ctx.supabase
      .from("prescription_verifications")
      .select("id, prescription_id, reservation_id, status, decision_reason, verified_at, item_decisions")
      .eq("shop_id", ctx.shopId),
  ]);

  if (resResult.error) {
    return NextResponse.json(
      { error: `Failed to load reservations: ${resResult.error.message}` },
      { status: 500 }
    );
  }

  const verifByPrescription = new Map<
    string,
    {
      id: string;
      status: PrescriptionVerificationStatus;
      decision_reason: string | null;
      verified_at: string | null;
    }
  >();
  for (const v of verifResult.data ?? []) {
    verifByPrescription.set(v.prescription_id, {
      id: v.id,
      status: v.status as PrescriptionVerificationStatus,
      decision_reason: v.decision_reason,
      verified_at: v.verified_at,
    });
  }

  const mapped = (resResult.data ?? []).map((row) => {
    const rawItems = Array.isArray(row.reservation_items)
      ? row.reservation_items
      : [];
    const rawHistory = Array.isArray(row.reservation_status_history)
      ? row.reservation_status_history
      : [];

    const items = rawItems.map((it: Record<string, unknown>) => {
      const med = it.medicines as {
        id: string;
        brand_name: string;
        composition_display: string;
        is_nti: boolean;
        is_schedule_h: boolean;
        mrp: number;
      } | null;
      const inv = it.shop_inventory as {
        id: string;
        quantity_on_hand: number;
        quantity_reserved: number;
        min_stock_threshold: number;
        is_available: boolean;
        is_archived: boolean;
        expiry_date: string | null;
        selling_price: number | null;
        mrp: number | null;
      } | null;

      const compText = med?.composition_display || med?.brand_name || "";
      const isNti = Boolean(med?.is_nti) || isNtiComposition(compText);
      const isScheduleH =
        Boolean(med?.is_schedule_h) || isNti || isScheduleHComposition(compText);

      const atp = inv
        ? calculateAvailableToPromise(inv.quantity_on_hand, inv.quantity_reserved)
        : 0;
      const invStatus = inv
        ? deriveInventoryStatus({
            quantityOnHand: inv.quantity_on_hand,
            quantityReserved: inv.quantity_reserved,
            minStockThreshold: inv.min_stock_threshold,
            isAvailable: inv.is_available,
            isArchived: inv.is_archived,
            expiryDate: inv.expiry_date,
          })
        : "out_of_stock";

      return {
        id: it.id as string,
        reservation_id: it.reservation_id as string,
        requested_medicine_id: it.requested_medicine_id as string,
        requested_brand_name: med?.brand_name || "Medicine",
        requested_composition: med?.composition_display ?? null,
        is_nti: isNti,
        is_schedule_h: isScheduleH,
        inventory_id: (it.inventory_id as string | null) ?? null,
        allow_alternative: Boolean(it.allow_alternative),
        item_status: it.item_status as ReservationItemStatus,
        suggested_medicine_id: (it.suggested_medicine_id as string | null) ?? null,
        requested_qty: (it.requested_qty as number) ?? 1,
        approved_qty: (it.approved_qty as number) ?? 0,
        stock_reserved_qty: (it.stock_reserved_qty as number) ?? 0,
        stock_deducted: Boolean(it.stock_deducted),
        item_note: (it.item_note as string | null) ?? null,
        final_price: (it.final_price as number | null) ?? null,
        updated_at: (it.updated_at as string | null) ?? null,
        live_available_to_promise: atp,
        live_inventory_status: invStatus,
        unit_price: inv?.selling_price ?? inv?.mrp ?? med?.mrp ?? null,
      };
    });

    const rxVerification = row.prescription_id
      ? verifByPrescription.get(row.prescription_id) ?? null
      : null;

    const sortedHistory = [...rawHistory].sort((a, b) =>
      String((b as Record<string, unknown>).created_at ?? "").localeCompare(
        String((a as Record<string, unknown>).created_at ?? "")
      )
    );

    return {
      id: row.id,
      shop_id: row.shop_id,
      prescription_id: row.prescription_id,
      plan_mode: row.plan_mode,
      verification_status: row.verification_status as VerificationStatus,
      order_status: row.order_status as LegacyOrderStatus,
      fulfilment_status: row.fulfilment_status as FulfilmentStatus,
      status_reason: row.status_reason,
      expires_at: row.expires_at,
      estimated_total: row.estimated_total,
      pharmacist_note: row.pharmacist_note,
      patient_display_label: `Patient #${String(row.patient_id).slice(0, 6).toUpperCase()}`,
      items,
      prescription_verification: rxVerification,
      history: sortedHistory,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  });

  const filtered = search
    ? mapped.filter((r) => {
        const hay = [
          r.id,
          r.patient_display_label,
          r.prescription_id,
          ...r.items.map((it) => it.requested_brand_name),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(search);
      })
    : mapped;

  return NextResponse.json({
    reservations: filtered,
  });
}

// ---------------------------------------------------------------------------
// 3. Pharmacist Fulfilment State Transition: POST /api/pharmacist/reservations/[id]/transition
// ---------------------------------------------------------------------------

export async function handleTransitionReservation(
  reservationId: string,
  rawBody: unknown,
  resolveContext: ContextResolver = requirePharmacistContext,
  emitNotification = createPharmacistNotification
): Promise<NextResponse> {
  const ctx = await resolveContext({ requireVerifiedShop: true });
  if (!ctx.ok) {
    return NextResponse.json(
      { error: ctx.error, code: ctx.code },
      { status: ctx.status }
    );
  }

  const idParse = uuidSchema.safeParse(reservationId);
  if (!idParse.success) {
    return NextResponse.json(
      { error: "Invalid reservation ID format" },
      { status: 400 }
    );
  }

  const parsed = reservationTransitionSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid transition payload", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const targetStatus = (parsed.data.target_status ?? parsed.data.to_status)!;
  const reasonText =
    parsed.data.reason?.trim() || parsed.data.pharmacist_note?.trim() || null;

  // Load reservation scoped strictly to ctx.shopId
  const { data: reservation, error: resErr } = await ctx.supabase
    .from("reservations")
    .select("*")
    .eq("id", idParse.data)
    .eq("shop_id", ctx.shopId)
    .maybeSingle();

  if (resErr) {
    return NextResponse.json(
      { error: `Failed to fetch reservation: ${resErr.message}` },
      { status: 500 }
    );
  }
  if (!reservation) {
    return NextResponse.json(
      { error: "Reservation not found for this pharmacy" },
      { status: 404 }
    );
  }

  const currentStatus = reservation.fulfilment_status as FulfilmentStatus;

  try {
    assertValidReservationTransition(currentStatus, targetStatus, reasonText);
  } catch (err) {
    if (err instanceof StateTransitionError) {
      const codeStatus = err.code === "REASON_REQUIRED" ? 400 : 409;
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: codeStatus }
      );
    }
    throw err;
  }

  // Load reservation items + medicine & inventory metadata
  const { data: itemRows, error: itemsErr } = await ctx.supabase
    .from("reservation_items")
    .select(
      "*, medicines(id, brand_name, composition_display, is_nti, is_schedule_h), shop_inventory(id, is_rx_required, is_available, is_archived, expiry_date, quantity_on_hand, quantity_reserved, min_stock_threshold)"
    )
    .eq("reservation_id", reservation.id)
    .order("id", { ascending: true });

  if (itemsErr) {
    return NextResponse.json(
      { error: `Failed to load reservation items: ${itemsErr.message}` },
      { status: 500 }
    );
  }

  const items = itemRows ?? [];
  const itemById = new Map(items.map((it) => [it.id, it]));

  // Build item approval map for 'approved' / 'partially_approved'
  const approvalsInput = parsed.data.item_approvals ?? [];
  if (targetStatus === "partially_approved" && approvalsInput.length === 0) {
    return NextResponse.json(
      {
        error:
          "item_approvals with per-item approved quantities is required for 'partially_approved'.",
      },
      { status: 400 }
    );
  }

  for (const app of approvalsInput) {
    const existingItem = itemById.get(app.reservation_item_id);
    if (!existingItem) {
      return NextResponse.json(
        {
          error: `Reservation item ${app.reservation_item_id} does not belong to this reservation.`,
        },
        { status: 400 }
      );
    }
    if (app.approved_qty > existingItem.requested_qty) {
      return NextResponse.json(
        {
          error: `Approved quantity (${app.approved_qty}) cannot exceed requested quantity (${existingItem.requested_qty}).`,
        },
        { status: 400 }
      );
    }
  }

  const approvalMap = new Map(
    approvalsInput.map((a) => [a.reservation_item_id, a])
  );

  if (targetStatus === "partially_approved") {
    const hasPositiveQty = approvalsInput.some((a) => a.approved_qty > 0);
    if (!hasPositiveQty) {
      return NextResponse.json(
        {
          error:
            "At least one item must have approved_qty > 0 for 'partially_approved'. Use 'rejected' instead.",
        },
        { status: 400 }
      );
    }
  }

  // Schedule H / Rx Verification Gate
  if (SCHEDULE_H_GATED_STATUSES.has(targetStatus)) {
    const rxRequiredApprovedItems = items.filter((it) => {
      const med = it.medicines as {
        brand_name?: string;
        composition_display?: string;
        is_nti?: boolean;
        is_schedule_h?: boolean;
      } | null;
      const inv = it.shop_inventory as { is_rx_required?: boolean } | null;

      const compText = med?.composition_display || med?.brand_name || "";
      const requiresRx =
        Boolean(med?.is_schedule_h) ||
        Boolean(med?.is_nti) ||
        Boolean(inv?.is_rx_required) ||
        isNtiComposition(compText) ||
        isScheduleHComposition(compText);

      if (!requiresRx) return false;

      if (targetStatus === "approved" || targetStatus === "partially_approved") {
        const override = approvalMap.get(it.id);
        const qty =
          override !== undefined
            ? override.approved_qty
            : targetStatus === "approved"
              ? it.requested_qty
              : it.approved_qty;
        return qty > 0;
      }
      return it.approved_qty > 0;
    });

    if (rxRequiredApprovedItems.length > 0) {
      if (!reservation.prescription_id) {
        return NextResponse.json(
          {
            error:
              "Schedule H / prescription-required items cannot be approved or fulfilled without an attached verified prescription.",
            code: "RX_VERIFICATION_REQUIRED",
          },
          { status: 422 }
        );
      }

      const { data: verif, error: verifErr } = await ctx.supabase
        .from("prescription_verifications")
        .select("id, status, item_decisions")
        .eq("prescription_id", reservation.prescription_id)
        .eq("shop_id", ctx.shopId)
        .maybeSingle();

      if (verifErr) {
        return NextResponse.json(
          { error: `Failed to verify prescription gate: ${verifErr.message}` },
          { status: 500 }
        );
      }

      if (
        !verif ||
        (verif.status !== "approved" && verif.status !== "partially_verified")
      ) {
        return NextResponse.json(
          {
            error: `Schedule H / Rx verification gate blocked: linked prescription status is '${verif?.status ?? "missing"}'. Licensed pharmacist verification is required first.`,
            code: "RX_VERIFICATION_REQUIRED",
          },
          { status: 422 }
        );
      }

      if (verif.status === "partially_verified" && Array.isArray(verif.item_decisions)) {
        const decisions = verif.item_decisions as Array<{
          medicine_id?: string | null;
          brand_name?: string;
          decision?: string;
        }>;
        for (const rxItem of rxRequiredApprovedItems) {
          const med = rxItem.medicines as { brand_name?: string } | null;
          const dec = decisions.find(
            (d) =>
              (d.medicine_id && d.medicine_id === rxItem.requested_medicine_id) ||
              (d.brand_name &&
                med?.brand_name &&
                d.brand_name.toLowerCase() === med.brand_name.toLowerCase())
          );
          if (dec && dec.decision !== "approved") {
            return NextResponse.json(
              {
                error: `Schedule H item '${med?.brand_name || rxItem.requested_medicine_id}' was not approved during partial prescription verification.`,
                code: "RX_VERIFICATION_REQUIRED",
              },
              { status: 422 }
            );
          }
        }
      }
    }
  }

  // Execute Atomic Postgres Stock RPCs
  if (targetStatus === "approved" || targetStatus === "partially_approved") {
    const rpcApprovals = items.map((it) => {
      const override = approvalMap.get(it.id);
      const qty =
        override !== undefined
          ? override.approved_qty
          : targetStatus === "approved"
            ? it.requested_qty
            : it.approved_qty;

      return {
        reservation_item_id: it.id,
        approved_qty: qty,
        ...(override?.inventory_id ? { inventory_id: override.inventory_id } : {}),
      };
    });

    const { error: reserveErr } = await ctx.supabase.rpc(
      "reserve_reservation_stock",
      {
        p_reservation_id: reservation.id,
        p_item_approvals: rpcApprovals as unknown as Json,
      }
    );

    if (reserveErr) {
      return NextResponse.json(
        {
          error: `Stock reservation failed: ${reserveErr.message}`,
          code: "STOCK_RESERVATION_CONFLICT",
        },
        { status: 409 }
      );
    }

    // Update item statuses and notes
    for (const app of rpcApprovals) {
      const existing = itemById.get(app.reservation_item_id);
      if (!existing) continue;
      const override = approvalMap.get(app.reservation_item_id);
      const nextItemStatus: ReservationItemStatus =
        app.approved_qty > 0
          ? existing.item_status === "substitute_approved"
            ? "substitute_approved"
            : "confirmed"
          : "declined";

      await ctx.supabase
        .from("reservation_items")
        .update({
          item_status: nextItemStatus,
          ...(override?.item_note !== undefined
            ? { item_note: override.item_note }
            : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    }
  } else if (
    RESERVED_STOCK_STATES.has(currentStatus) &&
    RELEASE_TARGET_STATES.has(targetStatus)
  ) {
    const { error: releaseErr } = await ctx.supabase.rpc(
      "release_reservation_stock",
      {
        p_reservation_id: reservation.id,
        p_reason: reasonText ?? undefined,
      }
    );

    if (releaseErr) {
      return NextResponse.json(
        { error: `Failed to release reserved stock: ${releaseErr.message}` },
        { status: 409 }
      );
    }
  } else if (targetStatus === "fulfilled") {
    const { error: fulfillErr } = await ctx.supabase.rpc(
      "fulfill_reservation_stock",
      {
        p_reservation_id: reservation.id,
      }
    );

    if (fulfillErr) {
      return NextResponse.json(
        { error: `Failed to fulfill reservation stock: ${fulfillErr.message}` },
        { status: 409 }
      );
    }

    // Check for low stock after fulfillment deduction
    const invIds = Array.from(
      new Set(
        items
          .map((it) => it.inventory_id)
          .filter((id): id is string => Boolean(id))
      )
    );
    if (invIds.length > 0) {
      const { data: postInvRows } = await ctx.supabase
        .from("shop_inventory")
        .select(
          "id, is_catalog_linked, custom_brand_name, custom_generic_name, quantity_on_hand, quantity_reserved, min_stock_threshold, is_archived, expiry_date, medicines(brand_name)"
        )
        .eq("shop_id", ctx.shopId)
        .in("id", invIds);

      for (const inv of postInvRows ?? []) {
        if (inv.is_archived || isInventoryExpired(inv.expiry_date)) continue;
        const atp = calculateAvailableToPromise(
          inv.quantity_on_hand,
          inv.quantity_reserved
        );
        const medObj = inv.medicines as { brand_name?: string } | null;
        const displayName = inv.is_catalog_linked
          ? medObj?.brand_name || "Catalog Medicine"
          : inv.custom_brand_name || inv.custom_generic_name || "Custom Medicine";

        if (atp <= inv.min_stock_threshold) {
          await emitNotification({
            shopId: ctx.shopId,
            eventType: "low_stock",
            title:
              atp <= 0
                ? `Out of stock: ${displayName}`
                : `Low stock alert: ${displayName}`,
            body: `Available-to-promise is ${atp} (threshold ${inv.min_stock_threshold}).`,
            entityType: "inventory",
            entityId: inv.id,
          });
        }
      }
    }
  }

  const hasSubstitutions = items.some(
    (it) =>
      it.item_status === "substitute_approved" ||
      it.item_status === "substitute_suggested"
  );
  const nextLegacyOrderStatus = mapFulfilmentToLegacyOrderStatus(
    targetStatus,
    hasSubstitutions
  );
  const nowIso = new Date().toISOString();

  const { data: updatedRes, error: updateErr } = await ctx.supabase
    .from("reservations")
    .update({
      fulfilment_status: targetStatus,
      order_status: nextLegacyOrderStatus,
      status_reason: reasonText ?? reservation.status_reason,
      ...(parsed.data.pharmacist_note
        ? { pharmacist_note: parsed.data.pharmacist_note }
        : {}),
      updated_at: nowIso,
    })
    .eq("id", reservation.id)
    .eq("shop_id", ctx.shopId)
    .select("*")
    .single();

  if (updateErr || !updatedRes) {
    return NextResponse.json(
      {
        error: `Failed to update reservation status: ${updateErr?.message || "Update error"}`,
      },
      { status: 500 }
    );
  }

  const { data: historyRow, error: histErr } = await ctx.supabase
    .from("reservation_status_history")
    .insert({
      reservation_id: reservation.id,
      shop_id: ctx.shopId,
      from_status: currentStatus,
      to_status: targetStatus,
      actor_id: ctx.user.id,
      actor_role: ctx.memberRole,
      reason: reasonText,
    })
    .select("*")
    .single();

  if (histErr) {
    console.warn(
      `[pharmacist-reservations] History insert warning for ${reservation.id}:`,
      histErr.message
    );
  }

  // Emit lifecycle notifications
  if (targetStatus === "cancelled") {
    await emitNotification({
      shopId: ctx.shopId,
      eventType: "reservation_cancelled",
      title: `Reservation #${reservation.id.slice(0, 8)} cancelled`,
      body: reasonText || "Reservation was cancelled and reserved stock released.",
      entityType: "reservation",
      entityId: reservation.id,
    });
  } else if (
    currentStatus === "awaiting_clarification" &&
    targetStatus === "under_review"
  ) {
    await emitNotification({
      shopId: ctx.shopId,
      eventType: "clarification_submitted",
      title: "Clarification updated",
      body: `Reservation #${reservation.id.slice(0, 8)} resumed review after clarification.`,
      entityType: "reservation",
      entityId: reservation.id,
    });
  }

  return NextResponse.json({
    reservation: updatedRes,
    history: historyRow ?? null,
  });
}
