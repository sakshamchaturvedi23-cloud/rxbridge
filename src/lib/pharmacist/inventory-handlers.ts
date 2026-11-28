/**
 * src/lib/pharmacist/inventory-handlers.ts
 *
 * Testable server handlers for Phase 5 Pharmacist Inventory Management CRUD,
 * atomic stock adjustments, soft-archival, and movement audit ledger queries.
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import type { MedicineSearchItem } from "@/lib/clinical/medicine-search";
import { requirePharmacistContext } from "@/lib/pharmacist/auth";
import {
  InventoryValidationError,
  isInventoryExpired,
  prepareInventoryInsertPayload,
  toInventoryItemDTO,
} from "@/lib/pharmacist/inventory-service";
import type { ContextResolver } from "@/lib/pharmacist/onboarding-handlers";
import type { Database } from "@/types/database.types";
import {
  inventoryCreateSchema,
  inventoryUpdateSchema,
  INVENTORY_STATUSES,
  type InventoryItemDTO,
  type InventoryMovementDTO,
  type InventoryMovementType,
  type InventoryStatus,
} from "@/types/pharmacist";

const uuidSchema = z.string().uuid("Invalid inventory ID");

const INVENTORY_WITH_MEDICINE_SELECT =
  "*, medicines(id, brand_name, manufacturer, pack_size, composition_display, composition_key, mrp, is_jan_aushadhi, is_nti, is_schedule_h)" as const;

type InventoryRowWithMed = Database["public"]["Tables"]["shop_inventory"]["Row"] & {
  medicines?: Partial<MedicineSearchItem> | null;
};

function mapRowToDto(row: InventoryRowWithMed): InventoryItemDTO {
  const med = row.medicines && typeof row.medicines === "object" ? row.medicines : null;
  return toInventoryItemDTO(row, med);
}

/**
 * GET /api/pharmacist/inventory
 */
export async function handleListInventory(
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

  const search = (searchParams.get("search") ?? "").trim().toLowerCase();
  const statusFilter = (searchParams.get("status") ?? "all").trim();
  const catalogLink = (searchParams.get("catalogLink") ?? "all").trim();
  const includeArchived = searchParams.get("includeArchived") === "true";

  const rawPage = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const rawPageSize = Number.parseInt(searchParams.get("pageSize") ?? "25", 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
  const pageSize =
    Number.isFinite(rawPageSize) && rawPageSize >= 1
      ? Math.min(rawPageSize, 100)
      : 25;

  let query = ctx.supabase
    .from("shop_inventory")
    .select(INVENTORY_WITH_MEDICINE_SELECT)
    .eq("shop_id", ctx.shopId)
    .order("updated_at", { ascending: false });

  if (!includeArchived) {
    query = query.eq("is_archived", false);
  }
  if (catalogLink === "linked") {
    query = query.eq("is_catalog_linked", true);
  } else if (catalogLink === "unlinked") {
    query = query.eq("is_catalog_linked", false);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: `Failed to query inventory: ${error.message}` },
      { status: 500 }
    );
  }

  const allDtos = ((data ?? []) as InventoryRowWithMed[]).map(mapRowToDto);

  const summary = {
    total: allDtos.length,
    in_stock: allDtos.filter((i) => i.status === "in_stock").length,
    low_stock: allDtos.filter((i) => i.status === "low_stock").length,
    out_of_stock: allDtos.filter((i) => i.status === "out_of_stock").length,
    unavailable: allDtos.filter((i) => i.status === "unavailable").length,
    expired: allDtos.filter((i) => i.status === "expired").length,
  };

  let filtered = allDtos;

  if (
    statusFilter !== "all" &&
    (INVENTORY_STATUSES as readonly string[]).includes(statusFilter)
  ) {
    filtered = filtered.filter((item) => item.status === (statusFilter as InventoryStatus));
  }

  if (search) {
    filtered = filtered.filter((item) => {
      const haystack = [
        item.display_name,
        item.generic_name,
        item.composition_display,
        item.batch_number,
        item.manufacturer,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(search);
    });
  }

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);

  return NextResponse.json({
    items,
    summary,
    pagination: {
      page: safePage,
      pageSize,
      total,
      totalPages,
    },
  });
}

/**
 * POST /api/pharmacist/inventory
 */
export async function handleCreateInventory(
  rawBody: unknown,
  resolveContext: ContextResolver = requirePharmacistContext
): Promise<NextResponse> {
  const ctx = await resolveContext();
  if (!ctx.ok) {
    return NextResponse.json(
      { error: ctx.error, code: ctx.code },
      { status: ctx.status }
    );
  }

  const parsed = inventoryCreateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid inventory payload", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const input = parsed.data;

  if (input.is_available && isInventoryExpired(input.expiry_date)) {
    return NextResponse.json(
      { error: "Cannot mark an expired batch as available." },
      { status: 400 }
    );
  }

  if (input.is_catalog_linked && input.medicine_id) {
    const { data: existingActive, error: dupErr } = await ctx.supabase
      .from("shop_inventory")
      .select("id")
      .eq("shop_id", ctx.shopId)
      .eq("medicine_id", input.medicine_id)
      .eq("is_archived", false)
      .limit(1);

    if (dupErr) {
      return NextResponse.json(
        { error: `Failed to check duplicate catalog entry: ${dupErr.message}` },
        { status: 500 }
      );
    }

    if (existingActive && existingActive.length > 0) {
      return NextResponse.json(
        {
          error: "This catalog medicine already exists in your active inventory.",
          existing_inventory_id: existingActive[0].id,
        },
        { status: 409 }
      );
    }
  }

  let insertPayload: Database["public"]["Tables"]["shop_inventory"]["Insert"];
  try {
    insertPayload = await prepareInventoryInsertPayload(
      ctx.supabase,
      ctx.shopId,
      input
    );
  } catch (err) {
    if (err instanceof InventoryValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  const { data: created, error: insertError } = await ctx.supabase
    .from("shop_inventory")
    .insert(insertPayload)
    .select(INVENTORY_WITH_MEDICINE_SELECT)
    .single();

  if (insertError || !created) {
    const status = insertError?.code === "23505" ? 409 : 500;
    return NextResponse.json(
      {
        error: `Failed to create inventory item: ${insertError?.message || "Insert error"}`,
      },
      { status }
    );
  }

  // Record initial_stock movement ledger entry
  const { error: movementError } = await ctx.supabase
    .from("inventory_movements")
    .insert({
      shop_id: ctx.shopId,
      inventory_id: created.id,
      medicine_id: created.medicine_id,
      previous_qty: 0,
      new_qty: created.quantity_on_hand,
      delta_qty: created.quantity_on_hand,
      movement_type: "initial_stock",
      actor_id: ctx.user.id,
      reason: "Initial inventory entry",
    });

  if (movementError) {
    console.warn(
      `[pharmacist-inventory] Failed to log initial_stock movement for ${created.id}:`,
      movementError.message
    );
  }

  return NextResponse.json(
    { item: mapRowToDto(created as InventoryRowWithMed) },
    { status: 201 }
  );
}

/**
 * Shared ownership loader for /api/pharmacist/inventory/[id]
 */
async function loadOwnedInventoryRow(
  ctx: Extract<Awaited<ReturnType<ContextResolver>>, { ok: true }>,
  inventoryId: string
): Promise<
  | { ok: true; row: InventoryRowWithMed }
  | { ok: false; response: NextResponse }
> {
  const idParse = uuidSchema.safeParse(inventoryId);
  if (!idParse.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid inventory ID format" },
        { status: 400 }
      ),
    };
  }

  const { data: row, error } = await ctx.supabase
    .from("shop_inventory")
    .select(INVENTORY_WITH_MEDICINE_SELECT)
    .eq("id", idParse.data)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `Failed to fetch inventory item: ${error.message}` },
        { status: 500 }
      ),
    };
  }

  if (!row) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Inventory item not found" },
        { status: 404 }
      ),
    };
  }

  if (row.shop_id !== ctx.shopId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden: inventory item belongs to another pharmacy" },
        { status: 403 }
      ),
    };
  }

  return { ok: true, row: row as InventoryRowWithMed };
}

/**
 * GET /api/pharmacist/inventory/[id]
 */
export async function handleGetInventoryById(
  inventoryId: string,
  resolveContext: ContextResolver = requirePharmacistContext
): Promise<NextResponse> {
  const ctx = await resolveContext();
  if (!ctx.ok) {
    return NextResponse.json(
      { error: ctx.error, code: ctx.code },
      { status: ctx.status }
    );
  }

  const loaded = await loadOwnedInventoryRow(ctx, inventoryId);
  if (!loaded.ok) return loaded.response;

  return NextResponse.json({ item: mapRowToDto(loaded.row) });
}

/**
 * PATCH /api/pharmacist/inventory/[id]
 */
export async function handlePatchInventoryById(
  inventoryId: string,
  rawBody: unknown,
  resolveContext: ContextResolver = requirePharmacistContext
): Promise<NextResponse> {
  const ctx = await resolveContext();
  if (!ctx.ok) {
    return NextResponse.json(
      { error: ctx.error, code: ctx.code },
      { status: ctx.status }
    );
  }

  const loaded = await loadOwnedInventoryRow(ctx, inventoryId);
  if (!loaded.ok) return loaded.response;
  const existing = loaded.row;

  const parsed = inventoryUpdateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid inventory update payload", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const data = parsed.data;

  // Enforce expired batch cannot be marked available
  const effectiveExpiry =
    data.expiry_date !== undefined ? data.expiry_date : existing.expiry_date;
  const effectiveAvailable =
    data.is_available !== undefined ? data.is_available : existing.is_available;

  if (effectiveAvailable === true && isInventoryExpired(effectiveExpiry)) {
    return NextResponse.json(
      { error: "Cannot mark an expired batch as available." },
      { status: 400 }
    );
  }

  // Compute stock delta if delta or quantity_on_hand changed
  let stockDelta = 0;
  if (data.delta !== undefined && data.delta !== 0) {
    stockDelta = data.delta;
  } else if (
    data.quantity_on_hand !== undefined &&
    data.quantity_on_hand !== existing.quantity_on_hand
  ) {
    stockDelta = data.quantity_on_hand - existing.quantity_on_hand;
  }

  if (stockDelta !== 0) {
    const targetQty = existing.quantity_on_hand + stockDelta;
    if (targetQty < 0) {
      return NextResponse.json(
        { error: "Stock on hand cannot become negative." },
        { status: 400 }
      );
    }
    if (targetQty < existing.quantity_reserved) {
      return NextResponse.json(
        {
          error: `Stock on hand (${targetQty}) cannot be less than quantity reserved (${existing.quantity_reserved}).`,
        },
        { status: 400 }
      );
    }

    const movementType: InventoryMovementType =
      data.movement_type ??
      (stockDelta > 0 ? "restock" : "manual_adjustment");

    const { error: rpcError } = await ctx.supabase.rpc(
      "adjust_shop_inventory",
      {
        p_inventory_id: existing.id,
        p_delta: stockDelta,
        p_movement_type: movementType,
        p_reason:
          data.reason?.trim() ||
          (stockDelta > 0 ? "Stock restock" : "Manual stock adjustment"),
      }
    );

    if (rpcError) {
      return NextResponse.json(
        { error: `Stock adjustment failed: ${rpcError.message}` },
        { status: 400 }
      );
    }
  }

  // Build metadata update payload (protect catalog-linked rows from custom_* injection)
  const metadataUpdate: Database["public"]["Tables"]["shop_inventory"]["Update"] = {
    stock_source: "pharmacy_reported",
  };

  if (data.mrp !== undefined) metadataUpdate.mrp = data.mrp;
  if (data.selling_price !== undefined) metadataUpdate.selling_price = data.selling_price;
  if (data.discount_pct !== undefined) metadataUpdate.discount_pct = data.discount_pct;
  if (data.min_stock_threshold !== undefined)
    metadataUpdate.min_stock_threshold = data.min_stock_threshold;
  if (data.batch_number !== undefined) metadataUpdate.batch_number = data.batch_number;
  if (data.expiry_date !== undefined) metadataUpdate.expiry_date = data.expiry_date;
  if (data.is_available !== undefined) metadataUpdate.is_available = data.is_available;
  if (data.is_rx_required !== undefined) metadataUpdate.is_rx_required = data.is_rx_required;
  if (data.is_archived !== undefined) {
    metadataUpdate.is_archived = data.is_archived;
    metadataUpdate.archived_at = data.is_archived ? new Date().toISOString() : null;
  }

  if (!existing.is_catalog_linked) {
    if (data.custom_brand_name !== undefined)
      metadataUpdate.custom_brand_name = data.custom_brand_name;
    if (data.custom_generic_name !== undefined)
      metadataUpdate.custom_generic_name = data.custom_generic_name;
    if (data.custom_composition !== undefined)
      metadataUpdate.custom_composition = data.custom_composition;
    if (data.custom_strength !== undefined)
      metadataUpdate.custom_strength = data.custom_strength;
    if (data.custom_dosage_form !== undefined)
      metadataUpdate.custom_dosage_form = data.custom_dosage_form;
    if (data.custom_pack_size !== undefined)
      metadataUpdate.custom_pack_size = data.custom_pack_size;
    if (data.custom_manufacturer !== undefined)
      metadataUpdate.custom_manufacturer = data.custom_manufacturer;
  }

  const { data: updatedRow, error: updateError } = await ctx.supabase
    .from("shop_inventory")
    .update(metadataUpdate)
    .eq("id", existing.id)
    .eq("shop_id", ctx.shopId)
    .select(INVENTORY_WITH_MEDICINE_SELECT)
    .single();

  if (updateError || !updatedRow) {
    return NextResponse.json(
      {
        error: `Failed to update inventory item: ${updateError?.message || "Update error"}`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    item: mapRowToDto(updatedRow as InventoryRowWithMed),
  });
}

/**
 * DELETE /api/pharmacist/inventory/[id]
 * Soft-archives the inventory row (never hard-deletes audit/reservation history).
 */
export async function handleArchiveInventoryById(
  inventoryId: string,
  resolveContext: ContextResolver = requirePharmacistContext
): Promise<NextResponse> {
  const ctx = await resolveContext();
  if (!ctx.ok) {
    return NextResponse.json(
      { error: ctx.error, code: ctx.code },
      { status: ctx.status }
    );
  }

  const loaded = await loadOwnedInventoryRow(ctx, inventoryId);
  if (!loaded.ok) return loaded.response;
  const existing = loaded.row;

  if (existing.is_archived) {
    return NextResponse.json({
      archived: true,
      item: mapRowToDto(existing),
    });
  }

  if (existing.quantity_reserved > 0) {
    return NextResponse.json(
      {
        error: `Cannot archive inventory while ${existing.quantity_reserved} unit(s) are reserved for active orders.`,
      },
      { status: 409 }
    );
  }

  const { data: archivedRow, error: archiveError } = await ctx.supabase
    .from("shop_inventory")
    .update({
      is_archived: true,
      archived_at: new Date().toISOString(),
      is_available: false,
    })
    .eq("id", existing.id)
    .eq("shop_id", ctx.shopId)
    .select(INVENTORY_WITH_MEDICINE_SELECT)
    .single();

  if (archiveError || !archivedRow) {
    return NextResponse.json(
      {
        error: `Failed to archive inventory item: ${archiveError?.message || "Update error"}`,
      },
      { status: 500 }
    );
  }

  const { error: movementError } = await ctx.supabase
    .from("inventory_movements")
    .insert({
      shop_id: ctx.shopId,
      inventory_id: existing.id,
      medicine_id: existing.medicine_id,
      previous_qty: existing.quantity_on_hand,
      new_qty: existing.quantity_on_hand,
      delta_qty: 0,
      movement_type: "archive",
      actor_id: ctx.user.id,
      reason: "Soft-archived inventory item",
    });

  if (movementError) {
    console.warn(
      `[pharmacist-inventory] Failed to log archive movement for ${existing.id}:`,
      movementError.message
    );
  }

  return NextResponse.json({
    archived: true,
    item: mapRowToDto(archivedRow as InventoryRowWithMed),
  });
}

/**
 * GET /api/pharmacist/inventory/[id]/movements
 */
export async function handleGetInventoryMovements(
  inventoryId: string,
  resolveContext: ContextResolver = requirePharmacistContext
): Promise<NextResponse> {
  const ctx = await resolveContext();
  if (!ctx.ok) {
    return NextResponse.json(
      { error: ctx.error, code: ctx.code },
      { status: ctx.status }
    );
  }

  const loaded = await loadOwnedInventoryRow(ctx, inventoryId);
  if (!loaded.ok) return loaded.response;

  const { data, error } = await ctx.supabase
    .from("inventory_movements")
    .select("*")
    .eq("inventory_id", loaded.row.id)
    .eq("shop_id", ctx.shopId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json(
      { error: `Failed to load inventory movements: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({
    inventoryId: loaded.row.id,
    movements: (data ?? []) as InventoryMovementDTO[],
  });
}
