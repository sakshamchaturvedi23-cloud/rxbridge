/**
 * tests/pharmacist-inventory-logic.test.ts
 *
 * Unit tests for Phase 3 Pharmacist Inventory Invariants, Status Derivation,
 * Expiry Exclusion & Manual/Unlinked Normalization:
 * - 0 <= quantity_reserved <= quantity_on_hand invariant
 * - available_to_promise calculation
 * - expiry_date <= today exclusion
 * - deterministic status priority: expired > unavailable > out_of_stock > low_stock > in_stock
 * - unlinked manual entry normalization via P2 clinical helpers
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  assertInventoryInvariant,
  calculateAvailableToPromise,
  deriveInventoryStatus,
  InventoryValidationError,
  isInventoryExpired,
  normalizeUnlinkedInventoryEntry,
  toInventoryItemDTO,
} from "../src/lib/pharmacist/inventory-service";
import {
  inventoryAdjustSchema,
  inventoryCreateSchema,
} from "../src/types/pharmacist";

test("calculateAvailableToPromise and assertInventoryInvariant enforce 0 <= reserved <= on_hand", () => {
  assert.equal(calculateAvailableToPromise(25, 10), 15);
  assert.equal(calculateAvailableToPromise(10, 10), 0);
  assert.equal(calculateAvailableToPromise(5, 12), 0);

  assert.doesNotThrow(() => assertInventoryInvariant(0, 0));
  assert.doesNotThrow(() => assertInventoryInvariant(20, 5));
  assert.doesNotThrow(() => assertInventoryInvariant(10, 10));

  assert.throws(
    () => assertInventoryInvariant(-1, 0),
    (err: unknown) => err instanceof InventoryValidationError
  );
  assert.throws(
    () => assertInventoryInvariant(10, -2),
    (err: unknown) => err instanceof InventoryValidationError
  );
  assert.throws(
    () => assertInventoryInvariant(10, 11),
    (err: unknown) => err instanceof InventoryValidationError
  );
  assert.throws(
    () => assertInventoryInvariant(10.5, 2),
    (err: unknown) => err instanceof InventoryValidationError
  );
});

test("isInventoryExpired treats expiry_date <= referenceDate as expired", () => {
  const ref = "2026-11-28";
  assert.equal(isInventoryExpired(null, ref), false);
  assert.equal(isInventoryExpired(undefined, ref), false);
  assert.equal(isInventoryExpired("2026-11-27", ref), true);
  assert.equal(isInventoryExpired("2026-11-28", ref), true);
  assert.equal(isInventoryExpired("2026-11-29", ref), false);
  assert.equal(isInventoryExpired("2027-05-01", ref), false);
});

test("deriveInventoryStatus follows deterministic priority order", () => {
  const ref = "2026-11-28";

  // 1. Expired takes highest priority even with high stock
  assert.equal(
    deriveInventoryStatus({
      quantityOnHand: 100,
      quantityReserved: 0,
      minStockThreshold: 5,
      isAvailable: true,
      isArchived: false,
      expiryDate: "2026-11-28",
      referenceDate: ref,
    }),
    "expired"
  );

  // 2. Archived or manually unavailable overrides stock numbers
  assert.equal(
    deriveInventoryStatus({
      quantityOnHand: 50,
      quantityReserved: 0,
      isAvailable: false,
      isArchived: false,
      expiryDate: "2027-01-01",
      referenceDate: ref,
    }),
    "unavailable"
  );
  assert.equal(
    deriveInventoryStatus({
      quantityOnHand: 50,
      quantityReserved: 0,
      isAvailable: true,
      isArchived: true,
      expiryDate: "2027-01-01",
      referenceDate: ref,
    }),
    "unavailable"
  );

  // 3. Out of stock when ATP <= 0 (including all on-hand reserved)
  assert.equal(
    deriveInventoryStatus({
      quantityOnHand: 10,
      quantityReserved: 10,
      minStockThreshold: 5,
      isAvailable: true,
      isArchived: false,
      expiryDate: "2027-01-01",
      referenceDate: ref,
    }),
    "out_of_stock"
  );

  // 4. Low stock when 0 < ATP <= minStockThreshold
  assert.equal(
    deriveInventoryStatus({
      quantityOnHand: 15,
      quantityReserved: 10,
      minStockThreshold: 5,
      isAvailable: true,
      isArchived: false,
      expiryDate: "2027-01-01",
      referenceDate: ref,
    }),
    "low_stock"
  );

  // 5. In stock when ATP > minStockThreshold
  assert.equal(
    deriveInventoryStatus({
      quantityOnHand: 16,
      quantityReserved: 10,
      minStockThreshold: 5,
      isAvailable: true,
      isArchived: false,
      expiryDate: "2027-01-01",
      referenceDate: ref,
    }),
    "in_stock"
  );
});

test("normalizeUnlinkedInventoryEntry builds canonical keys and detects NTI/Schedule H", () => {
  assert.throws(
    () => normalizeUnlinkedInventoryEntry({ custom_brand_name: "  ", custom_generic_name: "" }),
    (err: unknown) => err instanceof InventoryValidationError
  );

  const ntiManual = normalizeUnlinkedInventoryEntry({
    custom_brand_name: "Thyrox 50 Tablet",
    custom_generic_name: "Levothyroxine Sodium",
    custom_strength: "50mcg",
    custom_pack_size: "bottle of 100 tablets",
  });

  assert.equal(ntiManual.is_catalog_linked, false);
  assert.equal(ntiManual.medicine_id, null);
  assert.equal(ntiManual.composition_key, "levothyroxine-sodium-50mcg");
  assert.equal(ntiManual.is_nti, true);
  assert.equal(ntiManual.is_schedule_h, true);
  assert.equal(ntiManual.is_rx_required, true);
  assert.equal(ntiManual.custom_dosage_form, "oral_solid");

  const otcManual = normalizeUnlinkedInventoryEntry({
    custom_brand_name: "Local Paracetamol",
    custom_composition: "Paracetamol 500mg",
    custom_pack_size: "strip of 10 tablets",
  });

  assert.equal(otcManual.composition_key, "paracetamol-500mg");
  assert.equal(otcManual.is_nti, false);
  assert.equal(otcManual.is_schedule_h, false);
  assert.equal(otcManual.is_rx_required, false);
});

test("toInventoryItemDTO projects catalog-linked and unlinked rows accurately", () => {
  const unlinkedRow = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    shop_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    medicine_id: null,
    in_stock: true,
    discount_pct: 10,
    stock_source: "pharmacy_reported",
    is_catalog_linked: false,
    custom_brand_name: "Amoxyclav Local 625",
    custom_generic_name: "Amoxicillin + Clavulanic Acid",
    custom_composition: "Amoxicillin 500mg + Clavulanic Acid 125mg",
    custom_strength: "625mg",
    custom_dosage_form: "oral_solid",
    custom_pack_size: "strip of 10 tablets",
    custom_manufacturer: "Local Labs",
    is_rx_required: true,
    mrp: 180,
    selling_price: 162,
    quantity_on_hand: 12,
    quantity_reserved: 8,
    min_stock_threshold: 5,
    batch_number: "B-2026-01",
    expiry_date: "2027-06-01",
    is_available: true,
    is_archived: false,
    archived_at: null,
    updated_at: "2026-11-28T10:00:00Z",
  };

  const dto = toInventoryItemDTO(unlinkedRow, null, "2026-11-28");
  assert.equal(dto.display_name, "Amoxyclav Local 625");
  assert.equal(dto.available_to_promise, 4);
  assert.equal(dto.status, "low_stock");
  assert.equal(dto.is_expired, false);
  assert.equal(dto.is_schedule_h, true);
  assert.equal(dto.composition_key, "amoxicillin-500mg+clavulanic-acid-125mg");
});

test("inventoryCreateSchema and inventoryAdjustSchema validate catalog vs manual constraints", () => {
  // Catalog-linked without medicine_id fails
  assert.equal(
    inventoryCreateSchema.safeParse({
      is_catalog_linked: true,
      quantity_on_hand: 10,
    }).success,
    false
  );

  // Manual entry with medicine_id fails
  assert.equal(
    inventoryCreateSchema.safeParse({
      is_catalog_linked: false,
      medicine_id: "11111111-1111-4111-8111-111111111111",
      custom_brand_name: "Manual Item",
      quantity_on_hand: 10,
    }).success,
    false
  );

  // Valid manual entry passes
  assert.equal(
    inventoryCreateSchema.safeParse({
      is_catalog_linked: false,
      custom_brand_name: "Manual Item",
      quantity_on_hand: 10,
      expiry_date: "2027-01-15",
    }).success,
    true
  );

  // Zero-delta stock adjustment fails
  assert.equal(
    inventoryAdjustSchema.safeParse({
      delta: 0,
      movement_type: "restock",
    }).success,
    false
  );
});
