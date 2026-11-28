/**
 * src/lib/pharmacist/onboarding-handlers.ts
 *
 * Testable server handlers for Phase 4 Pharmacist Auth, Onboarding, Profile & Dashboard KPIs.
 * Route handlers under `src/app/api/pharmacist/*` delegate directly to these functions.
 */

import { NextResponse } from "next/server";
import {
  requirePharmacistContext,
  type PharmacistContextResult,
  type RequirePharmacistContextOptions,
} from "@/lib/pharmacist/auth";
import {
  calculateAvailableToPromise,
  deriveInventoryStatus,
  isInventoryExpired,
} from "@/lib/pharmacist/inventory-service";
import type { Database, Json } from "@/types/database.types";
import {
  pharmacistRegisterRequestSchema,
  shopSettingsUpdateSchema,
  type LowStockAlertItem,
  type PharmacistMemberProfile,
  type PharmacistMemberRole,
  type PharmacistOverviewKPIs,
} from "@/types/pharmacist";

export type ContextResolver = (
  options?: RequirePharmacistContextOptions
) => Promise<PharmacistContextResult>;

const FORBIDDEN_PROFILE_FIELDS = [
  "verification_status",
  "verification_note",
  "owner_id",
  "reliability_score",
  "total_requests",
  "confirmed_requests",
] as const;

export function findForbiddenProfileUpdateFields(
  body: unknown
): string[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return [];
  }
  const record = body as Record<string, unknown>;
  return FORBIDDEN_PROFILE_FIELDS.filter((key) =>
    Object.prototype.hasOwnProperty.call(record, key)
  );
}

/**
 * Handles GET /api/pharmacist/profile
 */
export async function handleGetPharmacistProfile(
  resolveContext: ContextResolver = requirePharmacistContext
): Promise<NextResponse> {
  const ctx = await resolveContext();
  if (!ctx.ok) {
    return NextResponse.json(
      { error: ctx.error, code: ctx.code },
      { status: ctx.status }
    );
  }

  const { data: memberRows, error: membersError } = await ctx.supabase
    .from("pharmacy_members")
    .select("id, shop_id, user_id, member_role, is_active, created_at, updated_at")
    .eq("shop_id", ctx.shopId)
    .order("created_at", { ascending: true });

  if (membersError) {
    return NextResponse.json(
      { error: `Failed to load pharmacy members: ${membersError.message}` },
      { status: 500 }
    );
  }

  const members: PharmacistMemberProfile[] = (memberRows ?? []).map((row) => ({
    ...row,
    member_role: row.member_role as PharmacistMemberRole,
    full_name:
      row.user_id === ctx.user.id
        ? (typeof ctx.user.user_metadata?.full_name === "string"
            ? ctx.user.user_metadata.full_name
            : null)
        : null,
  }));

  return NextResponse.json({
    shop: ctx.shop,
    memberRole: ctx.memberRole,
    members,
    canManageShop: ctx.memberRole === "owner",
    currentUser: {
      id: ctx.user.id,
      email: ctx.user.email ?? null,
    },
  });
}

/**
 * Handles PATCH /api/pharmacist/profile
 */
export async function handlePatchPharmacistProfile(
  rawBody: unknown,
  resolveContext: ContextResolver = requirePharmacistContext
): Promise<NextResponse> {
  const ctx = await resolveContext({ requiredRoles: ["owner"] });
  if (!ctx.ok) {
    return NextResponse.json(
      { error: ctx.error, code: ctx.code },
      { status: ctx.status }
    );
  }

  const forbidden = findForbiddenProfileUpdateFields(rawBody);
  if (forbidden.length > 0) {
    return NextResponse.json(
      {
        error: `Forbidden field(s) in profile update: ${forbidden.join(", ")}. Verification status and ownership cannot be self-modified.`,
        code: "FORBIDDEN_FIELDS",
      },
      { status: 403 }
    );
  }

  // Support optional latitude/longitude aliases cleanly
  const normalizedBody =
    rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? {
          ...(rawBody as Record<string, unknown>),
          lat:
            (rawBody as Record<string, unknown>).lat ??
            (rawBody as Record<string, unknown>).latitude,
          lng:
            (rawBody as Record<string, unknown>).lng ??
            (rawBody as Record<string, unknown>).longitude,
        }
      : rawBody;

  if (normalizedBody && typeof normalizedBody === "object" && !Array.isArray(normalizedBody)) {
    delete (normalizedBody as Record<string, unknown>).latitude;
    delete (normalizedBody as Record<string, unknown>).longitude;
  }

  const parsed = shopSettingsUpdateSchema.safeParse(normalizedBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid pharmacy profile update", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const { operating_hours, ...restFields } = parsed.data;
  const updates: Database["public"]["Tables"]["shops"]["Update"] = {
    ...restFields,
    updated_at: new Date().toISOString(),
    ...(operating_hours !== undefined
      ? { operating_hours: operating_hours as Json }
      : {}),
  };

  const { data: updatedShop, error: updateError } = await ctx.supabase
    .from("shops")
    .update(updates)
    .eq("id", ctx.shopId)
    .select(
      "id, name, shop_type, archetype, address, lat, lng, default_discount_pct, reliability_score, total_requests, confirmed_requests, owner_id, verification_status, verification_note, license_number, pharmacist_reg_number, contact_phone, contact_email, operating_hours, service_radius_km, created_at, updated_at"
    )
    .single();

  if (updateError || !updatedShop) {
    return NextResponse.json(
      {
        error: `Failed to update pharmacy profile: ${updateError?.message || "Update denied"}`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    shop: updatedShop,
    memberRole: ctx.memberRole,
  });
}

/**
 * Handles GET /api/pharmacist/dashboard
 */
export async function handleGetPharmacistDashboard(
  resolveContext: ContextResolver = requirePharmacistContext
): Promise<NextResponse> {
  const ctx = await resolveContext();
  if (!ctx.ok) {
    return NextResponse.json(
      { error: ctx.error, code: ctx.code },
      { status: ctx.status }
    );
  }

  const [invResult, rxVerifResult, resResult, notifResult, demandResult] =
    await Promise.all([
      ctx.supabase
        .from("shop_inventory")
        .select(
          "id, medicine_id, is_catalog_linked, custom_brand_name, custom_generic_name, quantity_on_hand, quantity_reserved, min_stock_threshold, is_available, is_archived, expiry_date, medicines(brand_name)"
        )
        .eq("shop_id", ctx.shopId)
        .eq("is_archived", false),
      ctx.supabase
        .from("prescription_verifications")
        .select("id, status")
        .eq("shop_id", ctx.shopId),
      ctx.supabase
        .from("reservations")
        .select("id, fulfilment_status")
        .eq("shop_id", ctx.shopId),
      ctx.supabase
        .from("pharmacist_notifications")
        .select("id", { count: "exact", head: true })
        .eq("shop_id", ctx.shopId)
        .eq("is_read", false),
      ctx.shop.verification_status === "verified"
        ? ctx.supabase
            .from("pharmacy_medicine_requests")
            .select("id", { count: "exact", head: true })
            .in("status", ["open", "responded", "partially_available"])
            .or(`target_shop_id.is.null,target_shop_id.eq.${ctx.shopId}`)
        : Promise.resolve({ count: 0, error: null }),
    ]);

  if (invResult.error) {
    return NextResponse.json(
      { error: `Failed to load inventory KPIs: ${invResult.error.message}` },
      { status: 500 }
    );
  }
  if (rxVerifResult.error) {
    return NextResponse.json(
      { error: `Failed to load verification KPIs: ${rxVerifResult.error.message}` },
      { status: 500 }
    );
  }
  if (resResult.error) {
    return NextResponse.json(
      { error: `Failed to load reservation KPIs: ${resResult.error.message}` },
      { status: 500 }
    );
  }
  if (notifResult.error) {
    return NextResponse.json(
      { error: `Failed to load notification count: ${notifResult.error.message}` },
      { status: 500 }
    );
  }

  const invRows = invResult.data ?? [];
  let totalAvailableItems = 0;
  let lowStockMedicines = 0;
  let outOfStockMedicines = 0;
  const lowStockAlerts: LowStockAlertItem[] = [];

  for (const row of invRows) {
    const atp = calculateAvailableToPromise(
      row.quantity_on_hand,
      row.quantity_reserved
    );
    const expired = isInventoryExpired(row.expiry_date);
    const derived = deriveInventoryStatus({
      quantityOnHand: row.quantity_on_hand,
      quantityReserved: row.quantity_reserved,
      minStockThreshold: row.min_stock_threshold,
      isAvailable: row.is_available,
      isArchived: row.is_archived,
      expiryDate: row.expiry_date,
    });

    if (row.is_available && !expired && atp > 0) {
      totalAvailableItems++;
    }
    if (derived === "low_stock") {
      lowStockMedicines++;
    }
    if (derived === "out_of_stock" || (!row.is_available && !expired)) {
      outOfStockMedicines++;
    }

    if (derived === "low_stock" || derived === "out_of_stock" || derived === "expired") {
      const medObj = row.medicines as { brand_name?: string } | null;
      const displayName = row.is_catalog_linked
        ? medObj?.brand_name || "Catalog Medicine"
        : row.custom_brand_name || row.custom_generic_name || "Custom Medicine";

      lowStockAlerts.push({
        id: row.id,
        displayName,
        availableToPromise: atp,
        minStockThreshold: row.min_stock_threshold,
        status: derived,
      });
    }
  }

  const verifications = rxVerifResult.data ?? [];
  const pendingPrescriptionVerifications = verifications.filter(
    (v) => v.status === "pending_review"
  ).length;
  const rejectedVerifications = verifications.filter(
    (v) => v.status === "rejected"
  ).length;

  const reservations = resResult.data ?? [];
  const approvedReservations = reservations.filter((r) =>
    ["approved", "partially_approved", "preparing", "ready_for_pickup"].includes(
      r.fulfilment_status
    )
  ).length;
  const rejectedReservations = reservations.filter(
    (r) => r.fulfilment_status === "rejected"
  ).length;
  const completedFulfilments = reservations.filter(
    (r) => r.fulfilment_status === "fulfilled"
  ).length;

  const kpis: PharmacistOverviewKPIs = {
    totalMedicinesListed: invRows.length,
    totalAvailableItems,
    lowStockMedicines,
    outOfStockMedicines,
    incomingPatientRequests: demandResult.count ?? 0,
    pendingPrescriptionVerifications,
    approvedReservations,
    rejectedRequests: rejectedReservations + rejectedVerifications,
    completedFulfilments,
  };

  return NextResponse.json({
    shop: ctx.shop,
    memberRole: ctx.memberRole,
    kpis,
    unreadNotifications: notifResult.count ?? 0,
    lowStockAlerts: lowStockAlerts.slice(0, 6),
  });
}

/**
 * Pure validator helper for registration payloads (testable without live Supabase).
 */
export function parsePharmacistRegisterPayload(rawBody: unknown) {
  return pharmacistRegisterRequestSchema.safeParse(rawBody);
}
