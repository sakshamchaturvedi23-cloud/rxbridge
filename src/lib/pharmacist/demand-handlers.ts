/**
 * src/lib/pharmacist/demand-handlers.ts
 *
 * Testable handlers for Phase 6 Part A: Privacy-Safe Patient Demand Visibility & Responses.
 * Strips patient_id & PII completely and computes live shop inventory availability.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import type { MedicineSearchItem } from "@/lib/clinical/medicine-search";
import {
  areDosageFormsCompatible,
  buildCanonicalCompositionKey,
  detectDosageForm,
  extractSaltNames,
} from "@/lib/clinical/normalize";
import { requirePharmacistContext } from "@/lib/pharmacist/auth";
import {
  calculateAvailableToPromise,
  isInventoryExpired,
} from "@/lib/pharmacist/inventory-service";
import type { ContextResolver } from "@/lib/pharmacist/onboarding-handlers";
import { createAdminClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";
import {
  demandResponseSchema,
  type DemandAvailabilityStatus,
  type DemandFeedItemDTO,
  type DemandRequestStatus,
  type DemandResponseDTO,
  type DemandStockMatch,
} from "@/types/pharmacist";

const uuidSchema = z.string().uuid("Invalid demand request ID");

export const SAFE_DEMAND_SELECT_FIELDS =
  "id, target_shop_id, medicine_id, medicine_name, active_ingredients, strength, dosage_form, requested_qty, service_area, latitude, longitude, status, created_at, updated_at" as const;

export function calculateDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}

type RawDemandRow = {
  id: string;
  target_shop_id: string | null;
  medicine_id: string | null;
  medicine_name: string;
  active_ingredients: string | null;
  strength: string | null;
  dosage_form: string | null;
  requested_qty: number;
  service_area: string | null;
  latitude: number | null;
  longitude: number | null;
  status: string;
  created_at: string;
  updated_at: string;
  [extra: string]: unknown;
};

type ShopInventoryWithMed = Database["public"]["Tables"]["shop_inventory"]["Row"] & {
  medicines?: Partial<MedicineSearchItem> | null;
};

/**
 * Computes live stock availability for a patient demand request against a shop's
 * non-archived, non-expired, available inventory.
 */
export function matchDemandAgainstInventory(
  request: Pick<
    RawDemandRow,
    "medicine_id" | "medicine_name" | "active_ingredients" | "strength" | "dosage_form" | "requested_qty"
  >,
  inventoryRows: ShopInventoryWithMed[]
): DemandStockMatch {
  const activeStock = inventoryRows.filter(
    (inv) =>
      !inv.is_archived &&
      inv.is_available &&
      !isInventoryExpired(inv.expiry_date) &&
      calculateAvailableToPromise(inv.quantity_on_hand, inv.quantity_reserved) > 0
  );

  // 1. Direct catalog medicine_id match first
  if (request.medicine_id) {
    const direct = activeStock.find((inv) => inv.medicine_id === request.medicine_id);
    if (direct) {
      const atp = calculateAvailableToPromise(
        direct.quantity_on_hand,
        direct.quantity_reserved
      );
      return {
        inStock: atp > 0,
        availableQty: atp,
        inventoryId: direct.id,
        unitPrice: direct.selling_price ?? direct.mrp ?? direct.medicines?.mrp ?? null,
        canFulfilFull: atp >= request.requested_qty,
      };
    }
  }

  // 2. Fallback: normalized composition/salt + compatible dosage form match
  const reqCompText = [request.active_ingredients, request.strength]
    .filter(Boolean)
    .join(" ")
    .trim();
  const reqCanonical = reqCompText ? buildCanonicalCompositionKey(reqCompText) : "";
  const reqSalts = reqCompText
    ? extractSaltNames(reqCompText)
    : extractSaltNames(request.medicine_name);
  const reqForm = request.dosage_form
    ? detectDosageForm(request.medicine_name, null, request.dosage_form)
    : detectDosageForm(request.medicine_name, null, reqCompText);

  let bestMatch: { inv: ShopInventoryWithMed; atp: number } | null = null;

  for (const inv of activeStock) {
    const invName = inv.is_catalog_linked
      ? inv.medicines?.brand_name ?? ""
      : inv.custom_brand_name ?? inv.custom_generic_name ?? "";
    const invComp = inv.is_catalog_linked
      ? inv.medicines?.composition_display ?? ""
      : inv.custom_composition ?? inv.custom_generic_name ?? "";
    const invPack = inv.is_catalog_linked
      ? inv.medicines?.pack_size ?? null
      : inv.custom_pack_size ?? null;

    const invForm = inv.custom_dosage_form
      ? detectDosageForm(invName, invPack, inv.custom_dosage_form)
      : detectDosageForm(invName, invPack, invComp);

    if (!areDosageFormsCompatible(reqForm, invForm)) {
      continue;
    }

    const invCanonical = invComp ? buildCanonicalCompositionKey(invComp) : "";
    const invSalts = invComp ? extractSaltNames(invComp) : extractSaltNames(invName);

    const exactCanonical =
      Boolean(reqCanonical) && Boolean(invCanonical) && reqCanonical === invCanonical;
    const saltOverlap =
      reqSalts.length > 0 &&
      reqSalts.every((salt) => invSalts.includes(salt));
    const nameMatch =
      invName.toLowerCase().includes(request.medicine_name.toLowerCase()) ||
      request.medicine_name.toLowerCase().includes(invName.toLowerCase());

    if (exactCanonical || saltOverlap || (invName && nameMatch)) {
      const atp = calculateAvailableToPromise(
        inv.quantity_on_hand,
        inv.quantity_reserved
      );
      if (!bestMatch || atp > bestMatch.atp) {
        bestMatch = { inv, atp };
      }
    }
  }

  if (!bestMatch) {
    return {
      inStock: false,
      availableQty: 0,
      inventoryId: null,
      unitPrice: null,
      canFulfilFull: false,
    };
  }

  return {
    inStock: bestMatch.atp > 0,
    availableQty: bestMatch.atp,
    inventoryId: bestMatch.inv.id,
    unitPrice:
      bestMatch.inv.selling_price ??
      bestMatch.inv.mrp ??
      bestMatch.inv.medicines?.mrp ??
      null,
    canFulfilFull: bestMatch.atp >= request.requested_qty,
  };
}

/**
 * Strips any patient PII (`patient_id`, raw coordinates, contact info) and builds
 * the anonymized `DemandFeedItemDTO`.
 */
export function sanitizeDemandRequestToDTO(
  row: RawDemandRow,
  distanceKm: number | null,
  myResponse: DemandResponseDTO | null,
  stockMatch: DemandStockMatch
): DemandFeedItemDTO {
  return {
    id: row.id,
    target_shop_id: row.target_shop_id,
    medicine_id: row.medicine_id,
    medicine_name: row.medicine_name,
    active_ingredients: row.active_ingredients,
    strength: row.strength,
    dosage_form: row.dosage_form,
    requested_qty: row.requested_qty,
    service_area: row.service_area,
    distance_km: distanceKm,
    status: row.status as DemandRequestStatus,
    created_at: row.created_at,
    updated_at: row.updated_at,
    my_response: myResponse,
    stock_match: stockMatch,
  };
}

/**
 * GET /api/pharmacist/demand
 */
export async function handleListDemand(
  searchParams: URLSearchParams,
  resolveContext: ContextResolver = requirePharmacistContext
): Promise<NextResponse> {
  const ctx = await resolveContext({ requireVerifiedShop: true });
  if (!ctx.ok) {
    return NextResponse.json(
      { error: ctx.error, code: ctx.code },
      { status: ctx.status }
    );
  }

  const medicineFilter = (searchParams.get("medicine") ?? "").trim().toLowerCase();
  const saltFilter = (searchParams.get("salt") ?? "").trim().toLowerCase();
  const strengthFilter = (searchParams.get("strength") ?? "").trim().toLowerCase();
  const dosageFormFilter = (searchParams.get("dosageForm") ?? "").trim().toLowerCase();
  const locationFilter = (searchParams.get("location") ?? "").trim().toLowerCase();
  const statusFilter = (searchParams.get("status") ?? "all").trim();
  const dateFrom = (searchParams.get("from") ?? searchParams.get("dateFrom") ?? "").trim();
  const dateTo = (searchParams.get("to") ?? searchParams.get("dateTo") ?? "").trim();

  const [reqRes, respRes, invRes] = await Promise.all([
    ctx.supabase
      .from("pharmacy_medicine_requests")
      .select(SAFE_DEMAND_SELECT_FIELDS)
      .or(`target_shop_id.eq.${ctx.shopId},target_shop_id.is.null`)
      .order("created_at", { ascending: false })
      .limit(100),
    ctx.supabase
      .from("pharmacy_demand_responses")
      .select("*")
      .eq("shop_id", ctx.shopId),
    ctx.supabase
      .from("shop_inventory")
      .select(
        "*, medicines(id, brand_name, manufacturer, pack_size, composition_display, composition_key, mrp, is_jan_aushadhi, is_nti, is_schedule_h)"
      )
      .eq("shop_id", ctx.shopId)
      .eq("is_archived", false),
  ]);

  if (reqRes.error) {
    return NextResponse.json(
      { error: `Failed to fetch demand feed: ${reqRes.error.message}` },
      { status: 500 }
    );
  }
  if (respRes.error) {
    return NextResponse.json(
      { error: `Failed to fetch demand responses: ${respRes.error.message}` },
      { status: 500 }
    );
  }
  if (invRes.error) {
    return NextResponse.json(
      { error: `Failed to fetch shop inventory: ${invRes.error.message}` },
      { status: 500 }
    );
  }

  const responseByRequestId = new Map<string, DemandResponseDTO>();
  for (const r of respRes.data ?? []) {
    responseByRequestId.set(r.request_id, {
      ...r,
      availability_status: r.availability_status as DemandAvailabilityStatus,
    });
  }

  const shopRadiusKm = ctx.shop.service_radius_km ?? 5;
  const shopAddressLower = ctx.shop.address.toLowerCase();
  const invRows = (invRes.data ?? []) as ShopInventoryWithMed[];

  const items: DemandFeedItemDTO[] = [];

  for (const raw of (reqRes.data ?? []) as RawDemandRow[]) {
    let distanceKm: number | null = null;

    if (raw.latitude !== null && raw.longitude !== null) {
      distanceKm = calculateDistanceKm(
        ctx.shop.lat,
        ctx.shop.lng,
        Number(raw.latitude),
        Number(raw.longitude)
      );
      if (raw.target_shop_id === null && distanceKm > shopRadiusKm) {
        continue;
      }
    } else if (raw.target_shop_id === null && raw.service_area?.trim()) {
      const areaTokens = raw.service_area
        .toLowerCase()
        .split(/[\s,]+/)
        .filter((t) => t.length >= 3);
      const areaMatches =
        areaTokens.length === 0 ||
        areaTokens.some((tok) => shopAddressLower.includes(tok));
      if (!areaMatches) {
        continue;
      }
    }

    if (statusFilter !== "all" && raw.status !== statusFilter) {
      continue;
    }
    if (medicineFilter && !raw.medicine_name.toLowerCase().includes(medicineFilter)) {
      continue;
    }
    if (
      saltFilter &&
      !(raw.active_ingredients ?? "").toLowerCase().includes(saltFilter)
    ) {
      continue;
    }
    if (
      strengthFilter &&
      !(raw.strength ?? "").toLowerCase().includes(strengthFilter)
    ) {
      continue;
    }
    if (
      dosageFormFilter &&
      !(raw.dosage_form ?? "").toLowerCase().includes(dosageFormFilter)
    ) {
      continue;
    }
    if (
      locationFilter &&
      !(raw.service_area ?? "").toLowerCase().includes(locationFilter)
    ) {
      continue;
    }
    if (dateFrom && raw.created_at.slice(0, 10) < dateFrom) {
      continue;
    }
    if (dateTo && raw.created_at.slice(0, 10) > dateTo) {
      continue;
    }

    const stockMatch = matchDemandAgainstInventory(raw, invRows);
    const myResponse = responseByRequestId.get(raw.id) ?? null;

    items.push(sanitizeDemandRequestToDTO(raw, distanceKm, myResponse, stockMatch));
  }

  return NextResponse.json({
    items,
    total: items.length,
    serviceRadiusKm: shopRadiusKm,
  });
}

/**
 * POST /api/pharmacist/demand/[id]/respond
 */
export async function handleRespondToDemand(
  requestId: string,
  rawBody: unknown,
  resolveContext: ContextResolver = requirePharmacistContext,
  getAdminClient = createAdminClient
): Promise<NextResponse> {
  const ctx = await resolveContext({ requireVerifiedShop: true });
  if (!ctx.ok) {
    return NextResponse.json(
      { error: ctx.error, code: ctx.code },
      { status: ctx.status }
    );
  }

  const idParse = uuidSchema.safeParse(requestId);
  if (!idParse.success) {
    return NextResponse.json(
      { error: "Invalid demand request ID format" },
      { status: 400 }
    );
  }

  const parsed = demandResponseSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid demand response payload", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const { data: reqRow, error: reqErr } = await ctx.supabase
    .from("pharmacy_medicine_requests")
    .select(SAFE_DEMAND_SELECT_FIELDS)
    .eq("id", idParse.data)
    .maybeSingle();

  if (reqErr) {
    return NextResponse.json(
      { error: `Failed to fetch demand request: ${reqErr.message}` },
      { status: 500 }
    );
  }

  if (!reqRow) {
    return NextResponse.json(
      { error: "Demand request not found or not visible to this pharmacy" },
      { status: 404 }
    );
  }

  if (reqRow.target_shop_id && reqRow.target_shop_id !== ctx.shopId) {
    return NextResponse.json(
      { error: "Forbidden: demand request is targeted to another pharmacy" },
      { status: 403 }
    );
  }

  if (reqRow.status === "closed" || reqRow.status === "converted_to_reservation") {
    return NextResponse.json(
      { error: `Demand request is already '${reqRow.status}'` },
      { status: 409 }
    );
  }

  const input = parsed.data;

  const { data: savedResponse, error: upsertErr } = await ctx.supabase
    .from("pharmacy_demand_responses")
    .upsert(
      {
        request_id: reqRow.id,
        shop_id: ctx.shopId,
        responded_by: ctx.user.id,
        availability_status: input.availability_status,
        available_qty: input.available_qty,
        quoted_unit_price: input.quoted_unit_price ?? null,
        note: input.note ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "request_id,shop_id" }
    )
    .select("*")
    .single();

  if (upsertErr || !savedResponse) {
    return NextResponse.json(
      { error: `Failed to save demand response: ${upsertErr?.message || "Upsert error"}` },
      { status: 500 }
    );
  }

  // Update aggregate status on pharmacy_medicine_requests cleanly via server-side admin client
  let nextRequestStatus: DemandRequestStatus = reqRow.status as DemandRequestStatus;
  if (input.availability_status === "available") {
    nextRequestStatus = "responded";
  } else if (
    input.availability_status === "partial" &&
    reqRow.status !== "responded"
  ) {
    nextRequestStatus = "partially_available";
  } else if (
    input.availability_status === "unavailable" &&
    reqRow.target_shop_id === ctx.shopId
  ) {
    nextRequestStatus = "unavailable";
  }

  if (nextRequestStatus !== reqRow.status) {
    try {
      const adminClient = getAdminClient();
      await adminClient
        .from("pharmacy_medicine_requests")
        .update({
          status: nextRequestStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", reqRow.id);
    } catch (syncErr) {
      console.warn("[pharmacist-demand] Status sync skipped:", syncErr);
    }
  }

  return NextResponse.json({
    response: {
      ...savedResponse,
      availability_status: savedResponse.availability_status as DemandAvailabilityStatus,
    },
    requestStatus: nextRequestStatus,
  });
}
