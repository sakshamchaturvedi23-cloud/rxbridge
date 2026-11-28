/**
 * src/lib/pharmacist/inventory-service.ts
 *
 * Pure inventory invariant & status derivation helpers plus catalog/unlinked
 * normalization for the pharmacist inventory module.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getMedicineById, type MedicineSearchItem } from "@/lib/clinical/medicine-search";
import { buildCompositionKey, detectDosageForm } from "@/lib/clinical/normalize";
import { isNtiComposition, isScheduleHComposition } from "@/lib/clinical/nti-list";
import type { Database } from "@/types/database.types";
import type {
  InventoryCreateInput,
  InventoryItemDTO,
  InventoryStatus,
} from "@/types/pharmacist";

export class InventoryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryValidationError";
  }
}

/**
 * Computes available-to-promise (ATP) stock: max(0, quantity_on_hand - quantity_reserved).
 */
export function calculateAvailableToPromise(
  quantityOnHand: number,
  quantityReserved: number
): number {
  if (!Number.isFinite(quantityOnHand) || !Number.isFinite(quantityReserved)) {
    return 0;
  }
  return Math.max(0, quantityOnHand - quantityReserved);
}

/**
 * Enforces the core stock invariant: 0 <= quantityReserved <= quantityOnHand,
 * with both values being finite integers.
 */
export function assertInventoryInvariant(
  quantityOnHand: number,
  quantityReserved: number
): void {
  if (!Number.isInteger(quantityOnHand) || quantityOnHand < 0) {
    throw new InventoryValidationError(
      `quantity_on_hand must be a non-negative integer (received ${quantityOnHand}).`
    );
  }
  if (!Number.isInteger(quantityReserved) || quantityReserved < 0) {
    throw new InventoryValidationError(
      `quantity_reserved must be a non-negative integer (received ${quantityReserved}).`
    );
  }
  if (quantityReserved > quantityOnHand) {
    throw new InventoryValidationError(
      `quantity_reserved (${quantityReserved}) cannot exceed quantity_on_hand (${quantityOnHand}).`
    );
  }
}

function toIsoDateOnly(input: string | Date): string | null {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return input.toISOString().slice(0, 10);
  }
  const trimmed = input.trim();
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/**
 * Treats `expiryDate <= today` (date-only YYYY-MM-DD comparison) as expired,
 * matching the DB trigger (`expiry_date > CURRENT_DATE` for active stock).
 */
export function isInventoryExpired(
  expiryDate: string | Date | null | undefined,
  referenceDate: string | Date = new Date()
): boolean {
  if (!expiryDate) return false;
  const expIso = toIsoDateOnly(expiryDate);
  const refIso = toIsoDateOnly(referenceDate);
  if (!expIso || !refIso) return false;
  return expIso <= refIso;
}

export interface DeriveInventoryStatusParams {
  quantityOnHand: number;
  quantityReserved: number;
  minStockThreshold?: number | null;
  isAvailable?: boolean;
  isArchived?: boolean;
  expiryDate?: string | Date | null;
  referenceDate?: string | Date;
}

/**
 * Derives deterministic inventory status in priority order:
 * 1. expired (expiry_date <= today)
 * 2. unavailable (is_archived === true or is_available === false)
 * 3. out_of_stock (availableToPromise <= 0)
 * 4. low_stock (availableToPromise <= minStockThreshold)
 * 5. in_stock
 */
export function deriveInventoryStatus(
  params: DeriveInventoryStatusParams
): InventoryStatus {
  if (isInventoryExpired(params.expiryDate, params.referenceDate)) {
    return "expired";
  }
  if (params.isArchived === true || params.isAvailable === false) {
    return "unavailable";
  }

  const atp = calculateAvailableToPromise(
    params.quantityOnHand,
    params.quantityReserved
  );
  if (atp <= 0) {
    return "out_of_stock";
  }

  const threshold = Math.max(0, params.minStockThreshold ?? 5);
  if (atp <= threshold) {
    return "low_stock";
  }

  return "in_stock";
}

export interface NormalizedUnlinkedInventory {
  is_catalog_linked: false;
  medicine_id: null;
  custom_brand_name: string | null;
  custom_generic_name: string | null;
  custom_composition: string | null;
  custom_strength: string | null;
  custom_dosage_form: string | null;
  custom_pack_size: string | null;
  custom_manufacturer: string | null;
  composition_key: string | null;
  is_nti: boolean;
  is_schedule_h: boolean;
  is_rx_required: boolean;
}

/**
 * Normalizes a manual/unlinked inventory entry using P2 clinical normalization
 * (`buildCompositionKey`, `detectDosageForm`, `isNtiComposition`, `isScheduleHComposition`)
 * without inserting uncurated records into `medicines`.
 */
export function normalizeUnlinkedInventoryEntry(input: {
  custom_brand_name?: string | null;
  custom_generic_name?: string | null;
  custom_composition?: string | null;
  custom_strength?: string | null;
  custom_dosage_form?: string | null;
  custom_pack_size?: string | null;
  custom_manufacturer?: string | null;
  is_rx_required?: boolean;
}): NormalizedUnlinkedInventory {
  const brand = input.custom_brand_name?.trim() || null;
  const generic = input.custom_generic_name?.trim() || null;

  if (!brand && !generic) {
    throw new InventoryValidationError(
      "Manual/unlinked inventory entries require custom_brand_name or custom_generic_name."
    );
  }

  const rawComp =
    input.custom_composition?.trim() ||
    [generic, input.custom_strength?.trim()].filter(Boolean).join(" ").trim() ||
    null;

  const compWithStrength =
    rawComp &&
    input.custom_strength?.trim() &&
    !rawComp.toLowerCase().includes(input.custom_strength.trim().toLowerCase())
      ? `${rawComp} ${input.custom_strength.trim()}`
      : rawComp;

  const compositionKey = compWithStrength
    ? buildCompositionKey(compWithStrength) || null
    : null;

  const clinicalText = compWithStrength || brand || generic || "";
  const isNti = isNtiComposition(clinicalText);
  const isScheduleH = isNti || isScheduleHComposition(clinicalText);

  const detectedForm = detectDosageForm(
    brand || generic || "",
    input.custom_pack_size,
    compWithStrength
  );

  return {
    is_catalog_linked: false,
    medicine_id: null,
    custom_brand_name: brand,
    custom_generic_name: generic,
    custom_composition: compWithStrength,
    custom_strength: input.custom_strength?.trim() || null,
    custom_dosage_form:
      input.custom_dosage_form?.trim() ||
      (detectedForm !== "unknown" ? detectedForm : null),
    custom_pack_size: input.custom_pack_size?.trim() || null,
    custom_manufacturer: input.custom_manufacturer?.trim() || null,
    composition_key: compositionKey,
    is_nti: isNti,
    is_schedule_h: isScheduleH,
    is_rx_required: Boolean(input.is_rx_required || isScheduleH || isNti),
  };
}

/**
 * Resolves and normalizes a catalog-linked or manual inventory creation payload
 * ready to insert into `shop_inventory`.
 */
export async function prepareInventoryInsertPayload(
  supabase: SupabaseClient<Database>,
  shopId: string,
  input: InventoryCreateInput
): Promise<Database["public"]["Tables"]["shop_inventory"]["Insert"]> {
  assertInventoryInvariant(input.quantity_on_hand, 0);

  if (input.is_catalog_linked) {
    if (!input.medicine_id) {
      throw new InventoryValidationError(
        "medicine_id is required for catalog-linked inventory items."
      );
    }

    const med = await getMedicineById(supabase, input.medicine_id);
    if (!med) {
      throw new InventoryValidationError(
        `Catalog medicine ${input.medicine_id} was not found.`
      );
    }

    const effectiveMrp = input.mrp ?? med.mrp;
    const discountPct = input.discount_pct ?? 0;
    const effectiveSellingPrice =
      input.selling_price ??
      Number((effectiveMrp * (1 - discountPct / 100)).toFixed(2));

    return {
      shop_id: shopId,
      medicine_id: med.id,
      is_catalog_linked: true,
      custom_brand_name: null,
      custom_generic_name: null,
      custom_composition: null,
      custom_strength: null,
      custom_dosage_form: null,
      custom_pack_size: null,
      custom_manufacturer: null,
      is_rx_required: Boolean(input.is_rx_required || med.is_schedule_h || med.is_nti),
      mrp: effectiveMrp,
      selling_price: effectiveSellingPrice,
      discount_pct: discountPct,
      stock_source: "pharmacy_reported",
      quantity_on_hand: input.quantity_on_hand,
      quantity_reserved: 0,
      min_stock_threshold: input.min_stock_threshold ?? 5,
      batch_number: input.batch_number ?? null,
      expiry_date: input.expiry_date ?? null,
      is_available: input.is_available ?? true,
      is_archived: false,
    };
  }

  const normalized = normalizeUnlinkedInventoryEntry(input);
  const effectiveMrp = input.mrp ?? null;
  const discountPct = input.discount_pct ?? 0;
  const effectiveSellingPrice =
    input.selling_price ??
    (effectiveMrp !== null
      ? Number((effectiveMrp * (1 - discountPct / 100)).toFixed(2))
      : null);

  return {
    shop_id: shopId,
    medicine_id: null,
    is_catalog_linked: false,
    custom_brand_name: normalized.custom_brand_name,
    custom_generic_name: normalized.custom_generic_name,
    custom_composition: normalized.custom_composition,
    custom_strength: normalized.custom_strength,
    custom_dosage_form: normalized.custom_dosage_form,
    custom_pack_size: normalized.custom_pack_size,
    custom_manufacturer: normalized.custom_manufacturer,
    is_rx_required: normalized.is_rx_required,
    mrp: effectiveMrp,
    selling_price: effectiveSellingPrice,
    discount_pct: discountPct,
    stock_source: "pharmacy_reported",
    quantity_on_hand: input.quantity_on_hand,
    quantity_reserved: 0,
    min_stock_threshold: input.min_stock_threshold ?? 5,
    batch_number: input.batch_number ?? null,
    expiry_date: input.expiry_date ?? null,
    is_available: input.is_available ?? true,
    is_archived: false,
  };
}

/**
 * Projects a raw `shop_inventory` DB row (plus optional joined `medicines` metadata)
 * into a clean, consistent `InventoryItemDTO`.
 */
export function toInventoryItemDTO(
  row: Database["public"]["Tables"]["shop_inventory"]["Row"],
  medicine?: Partial<MedicineSearchItem> | null,
  referenceDate?: string | Date
): InventoryItemDTO {
  const atp = calculateAvailableToPromise(
    row.quantity_on_hand,
    row.quantity_reserved
  );
  const expired = isInventoryExpired(row.expiry_date, referenceDate);
  const status = deriveInventoryStatus({
    quantityOnHand: row.quantity_on_hand,
    quantityReserved: row.quantity_reserved,
    minStockThreshold: row.min_stock_threshold,
    isAvailable: row.is_available,
    isArchived: row.is_archived,
    expiryDate: row.expiry_date,
    referenceDate,
  });

  const displayName = row.is_catalog_linked
    ? medicine?.brand_name || "Catalog Medicine"
    : row.custom_brand_name || row.custom_generic_name || "Custom Medicine";

  const compDisplay = row.is_catalog_linked
    ? medicine?.composition_display || null
    : row.custom_composition || row.custom_generic_name || null;

  const compKey = row.is_catalog_linked
    ? medicine?.composition_key || null
    : compDisplay
      ? buildCompositionKey(compDisplay) || null
      : null;

  const clinicalText = compDisplay || displayName;
  const isNti = Boolean(medicine?.is_nti) || isNtiComposition(clinicalText);
  const isScheduleH =
    Boolean(medicine?.is_schedule_h) ||
    isNti ||
    isScheduleHComposition(clinicalText);

  return {
    id: row.id,
    shop_id: row.shop_id,
    medicine_id: row.medicine_id,
    is_catalog_linked: row.is_catalog_linked,
    display_name: displayName,
    generic_name: row.custom_generic_name,
    composition_display: compDisplay,
    composition_key: compKey,
    strength: row.custom_strength,
    dosage_form: row.is_catalog_linked
      ? detectDosageForm(displayName, medicine?.pack_size, compDisplay)
      : row.custom_dosage_form || detectDosageForm(displayName, row.custom_pack_size, compDisplay),
    pack_size: row.is_catalog_linked ? medicine?.pack_size ?? null : row.custom_pack_size,
    manufacturer: row.is_catalog_linked ? medicine?.manufacturer ?? null : row.custom_manufacturer,
    is_rx_required: row.is_rx_required || isScheduleH || isNti,
    is_nti: isNti,
    is_schedule_h: isScheduleH,
    is_jan_aushadhi: Boolean(medicine?.is_jan_aushadhi),
    mrp: row.mrp ?? medicine?.mrp ?? null,
    selling_price: row.selling_price,
    discount_pct: row.discount_pct,
    quantity_on_hand: row.quantity_on_hand,
    quantity_reserved: row.quantity_reserved,
    available_to_promise: atp,
    min_stock_threshold: row.min_stock_threshold,
    batch_number: row.batch_number,
    expiry_date: row.expiry_date,
    stock_source: row.stock_source,
    in_stock: row.in_stock,
    is_available: row.is_available,
    is_archived: row.is_archived,
    status,
    is_expired: expired,
    updated_at: row.updated_at,
  };
}
