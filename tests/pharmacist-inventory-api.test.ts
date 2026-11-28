/**
 * tests/pharmacist-inventory-api.test.ts
 *
 * Phase 5 tests for Inventory Management API handlers:
 * - Unauthenticated (401) & cross-pharmacy (403) rejection
 * - Catalog-linked vs manual/unlinked validation and distinction
 * - Stock adjustments, 0 <= quantity_reserved <= quantity_on_hand enforcement,
 *   negative/expired stock rejection, low-stock calculation, and soft-archive + movement logging
 */

import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "../src/types/database.types";
import type { PharmacistContextResult } from "../src/lib/pharmacist/auth";
import {
  handleArchiveInventoryById,
  handleCreateInventory,
  handleGetInventoryById,
  handleGetInventoryMovements,
  handleListInventory,
  handlePatchInventoryById,
} from "../src/lib/pharmacist/inventory-handlers";
import type { PharmacyShopSummary } from "../src/types/pharmacist";

const SHOP_A_ID = "11111111-1111-4111-8111-111111111111";
const SHOP_B_ID = "22222222-2222-4222-8222-222222222222";
const MED_ID = "33333333-3333-4333-8333-333333333333";
const INV_A_ID = "44444444-4444-4444-8444-444444444444";
const INV_B_ID = "55555555-5555-4555-8555-555555555555";
const USER_ID = "66666666-6666-4666-8666-666666666666";

const MOCK_SHOP_A: PharmacyShopSummary = {
  id: SHOP_A_ID,
  name: "Shop A Pharmacy",
  shop_type: "chemist",
  archetype: "neighborhood",
  address: "10 Test Road",
  lat: 28.61,
  lng: 77.2,
  default_discount_pct: 0,
  reliability_score: 95,
  total_requests: 0,
  confirmed_requests: 0,
  owner_id: USER_ID,
  verification_status: "verified",
  verification_note: null,
  license_number: "DL-101",
  pharmacist_reg_number: "PR-101",
  contact_phone: "+91 9999999999",
  contact_email: "a@shop.in",
  operating_hours: {},
  service_radius_km: 5,
  created_at: "2026-11-28T00:00:00Z",
  updated_at: "2026-11-28T00:00:00Z",
};

function makeFakeSupabase(initialRows: Record<string, unknown>[]) {
  const inventoryRows = initialRows.map((r) => ({ ...r }));
  const movementRows: Record<string, unknown>[] = [];
  const medicines = [
    {
      id: MED_ID,
      brand_name: "Dolo 650 Tablet",
      manufacturer: "Micro Labs",
      pack_size: "strip of 15 tablets",
      composition_display: "Paracetamol (650mg)",
      composition_key: "paracetamol-650mg",
      mrp: 35,
      is_jan_aushadhi: false,
      is_nti: false,
      is_schedule_h: false,
    },
  ];

  const supabase = {
    from(table: string) {
      const filters: Array<(row: Record<string, unknown>) => boolean> = [];
      let pendingInsert: Record<string, unknown> | null = null;
      let pendingUpdate: Record<string, unknown> | null = null;

      const execSelect = () => {
        if (table === "medicines") {
          const rows = medicines.filter((m) =>
            filters.every((fn) => fn(m as unknown as Record<string, unknown>))
          );
          return { data: rows, error: null };
        }
        if (table === "shop_inventory") {
          const rows = inventoryRows
            .filter((r) => filters.every((fn) => fn(r)))
            .map((r) => ({
              ...r,
              medicines:
                r.medicine_id === MED_ID ? medicines[0] : null,
            }));
          return { data: rows, error: null };
        }
        if (table === "inventory_movements") {
          const rows = movementRows.filter((r) => filters.every((fn) => fn(r)));
          return { data: rows, error: null };
        }
        return { data: [], error: null };
      };

      const builder = {
        select() {
          return builder;
        },
        eq(col: string, val: unknown) {
          filters.push((r) => r[col] === val);
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        insert(payload: Record<string, unknown>) {
          pendingInsert = payload;
          if (table === "shop_inventory") {
            const created = {
              id: INV_A_ID,
              in_stock:
                ((payload.quantity_on_hand as number) ?? 0) > 0 &&
                Boolean(payload.is_available ?? true),
              updated_at: "2026-11-28T12:00:00Z",
              ...payload,
            };
            inventoryRows.push(created);
            pendingInsert = created;
          } else if (table === "inventory_movements") {
            const created = {
              id: `mv-${movementRows.length + 1}`,
              created_at: "2026-11-28T12:00:00Z",
              ...payload,
            };
            movementRows.push(created);
            pendingInsert = created;
          }
          return builder;
        },
        update(payload: Record<string, unknown>) {
          pendingUpdate = payload;
          return builder;
        },
        async maybeSingle() {
          const { data } = execSelect();
          return { data: data[0] ?? null, error: null };
        },
        async single() {
          if (pendingInsert) {
            if (table === "shop_inventory") {
              return {
                data: {
                  ...pendingInsert,
                  medicines:
                    pendingInsert.medicine_id === MED_ID ? medicines[0] : null,
                },
                error: null,
              };
            }
            return { data: pendingInsert, error: null };
          }
          if (pendingUpdate && table === "shop_inventory") {
            const idx = inventoryRows.findIndex((r) =>
              filters.every((fn) => fn(r))
            );
            if (idx === -1) return { data: null, error: { message: "Not found" } };
            inventoryRows[idx] = {
              ...inventoryRows[idx],
              ...pendingUpdate,
              updated_at: "2026-11-28T12:05:00Z",
            };
            const row = inventoryRows[idx];
            return {
              data: {
                ...row,
                medicines: row.medicine_id === MED_ID ? medicines[0] : null,
              },
              error: null,
            };
          }
          const { data } = execSelect();
          return { data: data[0] ?? null, error: null };
        },
        then(resolve: (val: { data: unknown[]; error: null }) => void) {
          if (pendingInsert && table === "inventory_movements") {
            resolve({ data: [pendingInsert], error: null });
            return;
          }
          resolve(execSelect());
        },
      };

      return builder;
    },
    async rpc(fnName: string, args: Record<string, unknown>) {
      if (fnName !== "adjust_shop_inventory") {
        return { data: null, error: { message: "Unknown RPC" } };
      }
      const inv = inventoryRows.find((r) => r.id === args.p_inventory_id);
      if (!inv) return { data: null, error: { message: "Not found" } };
      const prev = inv.quantity_on_hand as number;
      const next = prev + (args.p_delta as number);
      if (next < 0 || next < (inv.quantity_reserved as number)) {
        return { data: null, error: { message: "Invalid stock invariant" } };
      }
      inv.quantity_on_hand = next;
      movementRows.push({
        id: `mv-${movementRows.length + 1}`,
        shop_id: inv.shop_id,
        inventory_id: inv.id,
        medicine_id: inv.medicine_id,
        previous_qty: prev,
        new_qty: next,
        delta_qty: args.p_delta,
        movement_type: args.p_movement_type,
        actor_id: USER_ID,
        reservation_id: null,
        reason: args.p_reason ?? null,
        created_at: "2026-11-28T12:05:00Z",
      });
      return { data: inv, error: null };
    },
  };

  return { supabase: supabase as unknown as SupabaseClient<Database>, inventoryRows, movementRows };
}

function makeAuthResolver(supabase: SupabaseClient<Database>) {
  return async (): Promise<PharmacistContextResult> => ({
    ok: true,
    user: { id: USER_ID } as User,
    shopId: SHOP_A_ID,
    memberRole: "owner",
    shop: MOCK_SHOP_A,
    supabase,
  });
}

test("Unauthenticated inventory requests return 401", async () => {
  const unauth = async (): Promise<PharmacistContextResult> => ({
    ok: false,
    status: 401,
    code: "UNAUTHENTICATED",
    error: "Authentication required",
  });

  assert.equal((await handleListInventory(new URLSearchParams(), unauth)).status, 401);
  assert.equal((await handleCreateInventory({}, unauth)).status, 401);
  assert.equal((await handleGetInventoryById(INV_A_ID, unauth)).status, 401);
  assert.equal((await handlePatchInventoryById(INV_A_ID, {}, unauth)).status, 401);
  assert.equal((await handleArchiveInventoryById(INV_A_ID, unauth)).status, 401);
  assert.equal((await handleGetInventoryMovements(INV_A_ID, unauth)).status, 401);
});

test("Cross-pharmacy access to another shop's inventory item returns 403", async () => {
  const { supabase } = makeFakeSupabase([
    {
      id: INV_B_ID,
      shop_id: SHOP_B_ID,
      medicine_id: MED_ID,
      is_catalog_linked: true,
      quantity_on_hand: 20,
      quantity_reserved: 0,
      min_stock_threshold: 5,
      is_available: true,
      is_archived: false,
      expiry_date: "2027-06-01",
      mrp: 35,
      selling_price: 32,
      discount_pct: 0,
      stock_source: "pharmacy_reported",
      in_stock: true,
      is_rx_required: false,
      batch_number: "B1",
      custom_brand_name: null,
      custom_generic_name: null,
      custom_composition: null,
      custom_strength: null,
      custom_dosage_form: null,
      custom_pack_size: null,
      custom_manufacturer: null,
      archived_at: null,
      updated_at: "2026-11-28T10:00:00Z",
    },
  ]);

  const resolver = makeAuthResolver(supabase);
  assert.equal((await handleGetInventoryById(INV_B_ID, resolver)).status, 403);
  assert.equal(
    (await handlePatchInventoryById(INV_B_ID, { is_available: false }, resolver)).status,
    403
  );
  assert.equal((await handleArchiveInventoryById(INV_B_ID, resolver)).status, 403);
  assert.equal((await handleGetInventoryMovements(INV_B_ID, resolver)).status, 403);
});

test("POST /api/pharmacist/inventory supports catalog-linked & manual entries, logs initial_stock, and rejects expired/duplicate", async () => {
  const { supabase, movementRows } = makeFakeSupabase([]);
  const resolver = makeAuthResolver(supabase);

  // Expired batch marked available -> 400
  const expiredRes = await handleCreateInventory(
    {
      is_catalog_linked: false,
      custom_brand_name: "Old Syrup",
      quantity_on_hand: 5,
      expiry_date: "2020-01-01",
      is_available: true,
    },
    resolver
  );
  assert.equal(expiredRes.status, 400);

  // Valid catalog-linked create -> 201 + initial_stock movement
  const createCatalogRes = await handleCreateInventory(
    {
      is_catalog_linked: true,
      medicine_id: MED_ID,
      quantity_on_hand: 15,
      min_stock_threshold: 5,
      selling_price: 31.5,
      batch_number: "DOLO-26A",
      expiry_date: "2028-01-01",
    },
    resolver
  );
  assert.equal(createCatalogRes.status, 201);
  const createdJson = await createCatalogRes.json();
  assert.equal(createdJson.item.is_catalog_linked, true);
  assert.equal(createdJson.item.display_name, "Dolo 650 Tablet");
  assert.equal(createdJson.item.status, "in_stock");
  assert.equal(movementRows.length, 1);
  assert.equal(movementRows[0].movement_type, "initial_stock");
  assert.equal(movementRows[0].new_qty, 15);

  // Duplicate active catalog medicine -> 409
  const dupRes = await handleCreateInventory(
    {
      is_catalog_linked: true,
      medicine_id: MED_ID,
      quantity_on_hand: 10,
    },
    resolver
  );
  assert.equal(dupRes.status, 409);

  // Valid manual/unlinked entry -> 201
  const manualRes = await handleCreateInventory(
    {
      is_catalog_linked: false,
      custom_brand_name: "Local Amoxyclav 625",
      custom_composition: "Amoxicillin 500mg + Clavulanic Acid 125mg",
      quantity_on_hand: 3,
      min_stock_threshold: 5,
      expiry_date: "2028-01-01",
    },
    resolver
  );
  assert.equal(manualRes.status, 201);
  const manualJson = await manualRes.json();
  assert.equal(manualJson.item.is_catalog_linked, false);
  assert.equal(manualJson.item.status, "low_stock");
  assert.equal(manualJson.item.is_schedule_h, true);
});

test("PATCH enforces reserved stock floor, expired availability block, and soft-archive logs movement", async () => {
  const { supabase, inventoryRows, movementRows } = makeFakeSupabase([
    {
      id: INV_A_ID,
      shop_id: SHOP_A_ID,
      medicine_id: MED_ID,
      is_catalog_linked: true,
      quantity_on_hand: 10,
      quantity_reserved: 4,
      min_stock_threshold: 5,
      is_available: true,
      is_archived: false,
      expiry_date: "2028-06-01",
      mrp: 35,
      selling_price: 33,
      discount_pct: 0,
      stock_source: "pharmacy_reported",
      in_stock: true,
      is_rx_required: false,
      batch_number: "B1",
      custom_brand_name: null,
      custom_generic_name: null,
      custom_composition: null,
      custom_strength: null,
      custom_dosage_form: null,
      custom_pack_size: null,
      custom_manufacturer: null,
      archived_at: null,
      updated_at: "2026-11-28T10:00:00Z",
    },
  ]);

  const resolver = makeAuthResolver(supabase);

  // Cannot reduce below quantity_reserved (4)
  const belowReservedRes = await handlePatchInventoryById(
    INV_A_ID,
    { quantity_on_hand: 3 },
    resolver
  );
  assert.equal(belowReservedRes.status, 400);

  // Cannot mark expired batch available
  const expiredAvailableRes = await handlePatchInventoryById(
    INV_A_ID,
    { expiry_date: "2020-01-01", is_available: true },
    resolver
  );
  assert.equal(expiredAvailableRes.status, 400);

  // Valid restock via atomic RPC updates qty & logs movement
  const restockRes = await handlePatchInventoryById(
    INV_A_ID,
    { delta: 5, movement_type: "restock", reason: "Invoice #99" },
    resolver
  );
  assert.equal(restockRes.status, 200);
  const restockJson = await restockRes.json();
  assert.equal(restockJson.item.quantity_on_hand, 15);
  assert.equal(restockJson.item.available_to_promise, 11);
  assert.equal(movementRows[movementRows.length - 1].movement_type, "restock");

  // Cannot archive while reserved > 0
  const archiveBlockedRes = await handleArchiveInventoryById(INV_A_ID, resolver);
  assert.equal(archiveBlockedRes.status, 409);

  // Clear reserved and soft-archive -> 200 + archive movement logged (row preserved!)
  inventoryRows[0].quantity_reserved = 0;
  const archiveOkRes = await handleArchiveInventoryById(INV_A_ID, resolver);
  assert.equal(archiveOkRes.status, 200);
  assert.equal(inventoryRows[0].is_archived, true);
  assert.equal(inventoryRows[0].is_available, false);
  assert.equal(movementRows[movementRows.length - 1].movement_type, "archive");
});
