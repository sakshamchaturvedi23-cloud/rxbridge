/**
 * tests/pharmacist-reservations-integration.test.ts
 *
 * Phase 7 Integration & Security Tests:
 * - Reservation state machine transitions (valid lifecycle & invalid jump rejection)
 * - Schedule H / Rx verification gate before approving/preparing/fulfilling Rx items
 * - Atomic stock reservation, oversell prevention under concurrent requests, partial approval,
 *   stock release on cancellation/expiry, and idempotent reserve/fulfill (no double deduction)
 * - Database-backed notifications creation, shop scoping, and is_read persistence
 * - P1/P3 contract compatibility (CreateReservationRequest, PharmacistDecisionRequest, stable IDs,
 *   and shop_inventory.in_stock trigger synchronization)
 */

import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "../src/types/database.types";
import type {
  CreateReservationRequest,
  PharmacistDecisionRequest,
} from "../src/types/contracts";
import type { PharmacistContextResult } from "../src/lib/pharmacist/auth";
import {
  handleCreatePatientReservation,
  handleGetPatientReservation,
  handleTransitionReservation,
} from "../src/lib/pharmacist/reservation-handlers";
import {
  handleListNotifications,
  handleMarkNotificationsRead,
} from "../src/lib/pharmacist/notification-handlers";
import type { PharmacyShopSummary } from "../src/types/pharmacist";

const SHOP_A = "11111111-1111-4111-8111-111111111111";
const SHOP_B = "22222222-2222-4222-8222-222222222222";
const PATIENT_ID = "33333333-3333-4333-8333-333333333333";
const PHARMACIST_ID = "44444444-4444-4444-8444-444444444444";
const MED_OTC_ID = "55555555-5555-4555-8555-555555555555";
const MED_RX_ID = "66666666-6666-4666-8666-666666666666";
const INV_OTC_ID = "77777777-7777-4777-8777-777777777777";
const INV_RX_ID = "88888888-8888-4888-8888-888888888888";
const RX_ID = "99999999-9999-4999-8999-999999999999";

const VERIFIED_SHOP_A: PharmacyShopSummary = {
  id: SHOP_A,
  name: "Verified Shop A",
  shop_type: "chemist",
  archetype: "neighborhood",
  address: "10 Health Street",
  lat: 28.61,
  lng: 77.21,
  default_discount_pct: 0,
  reliability_score: 96,
  total_requests: 0,
  confirmed_requests: 0,
  owner_id: PHARMACIST_ID,
  verification_status: "verified",
  verification_note: null,
  license_number: "DL-A",
  pharmacist_reg_number: "PR-A",
  contact_phone: "+91 9000000001",
  contact_email: "a@rx.in",
  operating_hours: {},
  service_radius_km: 5,
  created_at: "2026-11-28T00:00:00Z",
  updated_at: "2026-11-28T00:00:00Z",
};

interface SimState {
  shops: Array<{ id: string; name: string; verification_status: string }>;
  medicines: Array<{
    id: string;
    brand_name: string;
    composition_display: string;
    mrp: number;
    is_nti: boolean;
    is_schedule_h: boolean;
  }>;
  inventory: Array<{
    id: string;
    shop_id: string;
    medicine_id: string;
    is_catalog_linked: boolean;
    custom_brand_name: string | null;
    custom_generic_name: string | null;
    is_rx_required: boolean;
    is_available: boolean;
    is_archived: boolean;
    expiry_date: string | null;
    quantity_on_hand: number;
    quantity_reserved: number;
    min_stock_threshold: number;
    selling_price: number | null;
    mrp: number | null;
    discount_pct: number;
    in_stock: boolean;
  }>;
  prescriptions: Array<{ id: string; patient_id: string }>;
  verifications: Array<{
    id: string;
    prescription_id: string;
    shop_id: string;
    reservation_id: string | null;
    status: string;
    item_decisions: unknown[];
  }>;
  reservations: Array<{
    id: string;
    patient_id: string;
    shop_id: string;
    prescription_id: string | null;
    plan_mode: string;
    verification_status: string;
    order_status: string;
    fulfilment_status: string;
    status_reason: string | null;
    pharmacist_note: string | null;
    estimated_total: number;
    created_at: string;
    updated_at: string;
  }>;
  reservationItems: Array<{
    id: string;
    reservation_id: string;
    requested_medicine_id: string;
    inventory_id: string | null;
    allow_alternative: boolean;
    item_status: string;
    suggested_medicine_id: string | null;
    requested_qty: number;
    approved_qty: number;
    stock_reserved_qty: number;
    stock_deducted: boolean;
    item_note: string | null;
    final_price: number | null;
    updated_at: string;
  }>;
  history: Array<Record<string, unknown>>;
  movements: Array<Record<string, unknown>>;
  notifications: Array<{
    id: string;
    shop_id: string;
    recipient_user_id: string | null;
    event_type: string;
    title: string;
    body: string;
    entity_type: string | null;
    entity_id: string | null;
    is_read: boolean;
    read_at: string | null;
    created_at: string;
  }>;
}

function syncInStock(inv: SimState["inventory"][number]) {
  inv.in_stock =
    inv.quantity_on_hand - inv.quantity_reserved > 0 &&
    inv.is_available &&
    !inv.is_archived;
}

function createSimEnv(initial?: Partial<SimState>) {
  const state: SimState = {
    shops: [
      { id: SHOP_A, name: "Verified Shop A", verification_status: "verified" },
      { id: SHOP_B, name: "Pending Shop B", verification_status: "pending" },
    ],
    medicines: [
      {
        id: MED_OTC_ID,
        brand_name: "Dolo 650",
        composition_display: "Paracetamol 650mg",
        mrp: 35,
        is_nti: false,
        is_schedule_h: false,
      },
      {
        id: MED_RX_ID,
        brand_name: "Augmentin 625 Duo",
        composition_display: "Amoxicillin 500mg + Clavulanic Acid 125mg",
        mrp: 200,
        is_nti: false,
        is_schedule_h: true,
      },
    ],
    inventory: [
      {
        id: INV_OTC_ID,
        shop_id: SHOP_A,
        medicine_id: MED_OTC_ID,
        is_catalog_linked: true,
        custom_brand_name: null,
        custom_generic_name: null,
        is_rx_required: false,
        is_available: true,
        is_archived: false,
        expiry_date: "2028-12-31",
        quantity_on_hand: 5,
        quantity_reserved: 0,
        min_stock_threshold: 2,
        selling_price: 30,
        mrp: 35,
        discount_pct: 0,
        in_stock: true,
      },
      {
        id: INV_RX_ID,
        shop_id: SHOP_A,
        medicine_id: MED_RX_ID,
        is_catalog_linked: true,
        custom_brand_name: null,
        custom_generic_name: null,
        is_rx_required: true,
        is_available: true,
        is_archived: false,
        expiry_date: "2028-12-31",
        quantity_on_hand: 10,
        quantity_reserved: 0,
        min_stock_threshold: 3,
        selling_price: 185,
        mrp: 200,
        discount_pct: 0,
        in_stock: true,
      },
    ],
    prescriptions: [{ id: RX_ID, patient_id: PATIENT_ID }],
    verifications: [],
    reservations: [],
    reservationItems: [],
    history: [],
    movements: [],
    notifications: [],
    ...initial,
  };

  let seq = 1;
  const nextUuid = (prefix: string) =>
    `${prefix.padStart(8, "0")}-0000-4000-8000-${String(seq++).padStart(12, "0")}`;

  function buildClient(actorUserId: string) {
    const client = {
      auth: {
        async getUser() {
          return { data: { user: { id: actorUserId } as User }, error: null };
        },
      },
      from(table: string) {
        const filters: Array<(r: Record<string, unknown>) => boolean> = [];
        let pendingOp:
          | { type: "insert"; rows: Record<string, unknown>[] }
          | { type: "upsert"; row: Record<string, unknown> }
          | { type: "update"; patch: Record<string, unknown> }
          | null = null;
        let headOnly = false;

        function getTableRows(): Record<string, unknown>[] {
          switch (table) {
            case "shops":
              return state.shops as unknown as Record<string, unknown>[];
            case "medicines":
              return state.medicines as unknown as Record<string, unknown>[];
            case "shop_inventory":
              return state.inventory as unknown as Record<string, unknown>[];
            case "prescriptions":
              return state.prescriptions as unknown as Record<string, unknown>[];
            case "prescription_verifications":
              return state.verifications as unknown as Record<string, unknown>[];
            case "reservations":
              return state.reservations as unknown as Record<string, unknown>[];
            case "reservation_items":
              return state.reservationItems as unknown as Record<string, unknown>[];
            case "reservation_status_history":
              return state.history;
            case "inventory_movements":
              return state.movements;
            case "pharmacist_notifications":
              return state.notifications as unknown as Record<string, unknown>[];
            default:
              return [];
          }
        }

        function enrichRow(r: Record<string, unknown>) {
          if (table === "reservation_items") {
            return {
              ...r,
              medicines:
                state.medicines.find((m) => m.id === r.requested_medicine_id) ?? null,
              shop_inventory:
                state.inventory.find((i) => i.id === r.inventory_id) ?? null,
            };
          }
          if (table === "shop_inventory") {
            return {
              ...r,
              medicines: state.medicines.find((m) => m.id === r.medicine_id) ?? null,
            };
          }
          return r;
        }

        function execute(): {
          data: Record<string, unknown>[];
          count: number;
          error: null;
        } {
          const rows = getTableRows();

          if (pendingOp?.type === "insert") {
            const inserted = pendingOp.rows.map((row) => {
              const created = {
                id: nextUuid(table === "reservations" ? "aaaaaaaa" : "bbbbbbbb"),
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                ...row,
              };
              rows.push(created);
              return created;
            });
            return { data: inserted, count: inserted.length, error: null };
          }

          if (pendingOp?.type === "upsert") {
            const upsertRow = pendingOp.row;
            const existingIdx = rows.findIndex(
              (r) =>
                r.prescription_id === upsertRow.prescription_id &&
                r.shop_id === upsertRow.shop_id
            );
            if (existingIdx >= 0) {
              rows[existingIdx] = { ...rows[existingIdx], ...upsertRow };
              return { data: [rows[existingIdx]], count: 1, error: null };
            }
            const created = {
              id: nextUuid("cccccccc"),
              item_decisions: [],
              created_at: new Date().toISOString(),
              ...upsertRow,
            };
            rows.push(created);
            return { data: [created], count: 1, error: null };
          }

          if (pendingOp?.type === "update") {
            const matched: Record<string, unknown>[] = [];
            for (let i = 0; i < rows.length; i++) {
              if (filters.every((fn) => fn(rows[i]))) {
                rows[i] = { ...rows[i], ...pendingOp.patch };
                matched.push(rows[i]);
              }
            }
            return { data: matched, count: matched.length, error: null };
          }

          const matched = rows
            .filter((r) => filters.every((fn) => fn(r)))
            .map(enrichRow);

          return {
            data: headOnly ? [] : matched,
            count: matched.length,
            error: null,
          };
        }

        const builder = {
          select(_cols?: string, opts?: { count?: string; head?: boolean }) {
            if (opts?.head) headOnly = true;
            return builder;
          },
          eq(col: string, val: unknown) {
            filters.push((r) => r[col] === val);
            return builder;
          },
          in(col: string, vals: unknown[]) {
            filters.push((r) => vals.includes(r[col]));
            return builder;
          },
          or(expr: string) {
            if (expr.includes("recipient_user_id")) {
              filters.push(
                (r) =>
                  r.recipient_user_id === null ||
                  r.recipient_user_id === actorUserId
              );
            }
            return builder;
          },
          order() {
            return builder;
          },
          limit() {
            return builder;
          },
          insert(payload: Record<string, unknown> | Record<string, unknown>[]) {
            pendingOp = {
              type: "insert",
              rows: Array.isArray(payload) ? payload : [payload],
            };
            return builder;
          },
          upsert(payload: Record<string, unknown>) {
            pendingOp = { type: "upsert", row: payload };
            return builder;
          },
          update(payload: Record<string, unknown>) {
            pendingOp = { type: "update", patch: payload };
            return builder;
          },
          async maybeSingle() {
            const res = execute();
            return { data: res.data[0] ?? null, error: null };
          },
          async single() {
            const res = execute();
            return { data: res.data[0] ?? null, error: null };
          },
          then(
            resolve: (val: {
              data: Record<string, unknown>[];
              count: number;
              error: null;
            }) => void
          ) {
            resolve(execute());
          },
        };

        return builder;
      },
      async rpc(fnName: string, args: Record<string, unknown>) {
        const resId = args.p_reservation_id as string;
        const res = state.reservations.find((r) => r.id === resId);
        if (!res) return { data: null, error: { message: "Reservation not found" } };

        const items = state.reservationItems.filter(
          (it) => it.reservation_id === resId
        );

        if (fnName === "reserve_reservation_stock") {
          const approvals = (args.p_item_approvals ?? []) as Array<{
            reservation_item_id: string;
            approved_qty: number;
            inventory_id?: string;
          }>;

          // Validate all items atomically before mutating
          const plan: Array<{
            item: SimState["reservationItems"][number];
            inv: SimState["inventory"][number];
            targetQty: number;
            delta: number;
          }> = [];

          for (const item of items) {
            if (item.stock_deducted) continue;
            const ov = approvals.find((a) => a.reservation_item_id === item.id);
            const targetQty = ov ? ov.approved_qty : item.approved_qty;
            const delta = targetQty - item.stock_reserved_qty;
            const invId =
              ov?.inventory_id ??
              item.inventory_id ??
              state.inventory.find(
                (i) =>
                  i.shop_id === res.shop_id &&
                  i.medicine_id === item.requested_medicine_id &&
                  !i.is_archived
              )?.id;

            if (delta > 0) {
              const inv = state.inventory.find((i) => i.id === invId);
              if (!inv || inv.is_archived || !inv.is_available) {
                return {
                  data: null,
                  error: { message: "Inventory unavailable for reservation" },
                };
              }
              const atp = inv.quantity_on_hand - inv.quantity_reserved;
              if (atp < delta) {
                return {
                  data: null,
                  error: {
                    message: `Insufficient available stock for inventory ${inv.id} (available ${atp}, needed ${delta})`,
                  },
                };
              }
              plan.push({ item, inv, targetQty, delta });
            }
          }

          for (const p of plan) {
            p.inv.quantity_reserved += p.delta;
            syncInStock(p.inv);
            p.item.inventory_id = p.inv.id;
            p.item.approved_qty = p.targetQty;
            p.item.stock_reserved_qty += p.delta;
            state.movements.push({
              id: nextUuid("dddddddd"),
              shop_id: res.shop_id,
              inventory_id: p.inv.id,
              movement_type: "reservation_hold",
              delta_qty: -p.delta,
              reservation_id: resId,
            });
          }
          return { data: { reservation_id: resId }, error: null };
        }

        if (fnName === "release_reservation_stock") {
          for (const item of items) {
            if (item.stock_reserved_qty <= 0 || item.stock_deducted) continue;
            const inv = state.inventory.find((i) => i.id === item.inventory_id);
            if (inv) {
              const rel = Math.min(item.stock_reserved_qty, inv.quantity_reserved);
              inv.quantity_reserved = Math.max(0, inv.quantity_reserved - rel);
              syncInStock(inv);
              state.movements.push({
                id: nextUuid("eeeeeeee"),
                shop_id: res.shop_id,
                inventory_id: inv.id,
                movement_type: "reservation_release",
                delta_qty: rel,
                reservation_id: resId,
              });
            }
            item.stock_reserved_qty = 0;
          }
          return { data: { reservation_id: resId }, error: null };
        }

        if (fnName === "fulfill_reservation_stock") {
          for (const item of items) {
            if (item.stock_deducted || item.approved_qty <= 0) continue;
            const inv = state.inventory.find((i) => i.id === item.inventory_id);
            if (!inv) {
              return { data: null, error: { message: "Missing inventory" } };
            }
            if (
              inv.quantity_on_hand < item.approved_qty ||
              inv.quantity_reserved < item.stock_reserved_qty
            ) {
              return { data: null, error: { message: "Insufficient stock" } };
            }
            inv.quantity_on_hand -= item.approved_qty;
            inv.quantity_reserved -= item.stock_reserved_qty;
            syncInStock(inv);
            item.stock_deducted = true;
            item.stock_reserved_qty = 0;
            state.movements.push({
              id: nextUuid("ffffffff"),
              shop_id: res.shop_id,
              inventory_id: inv.id,
              movement_type: "reservation_fulfill",
              delta_qty: -item.approved_qty,
              reservation_id: resId,
            });
          }
          return { data: { reservation_id: resId }, error: null };
        }

        return { data: null, error: { message: "Unknown RPC" } };
      },
    } as unknown as SupabaseClient<Database>;

    return client;
  }

  const patientClient = buildClient(PATIENT_ID);
  const pharmacistClient = buildClient(PHARMACIST_ID);
  const adminClient = buildClient("service-role");

  const pharmacistResolver = async (): Promise<PharmacistContextResult> => ({
    ok: true,
    user: { id: PHARMACIST_ID } as User,
    shopId: SHOP_A,
    memberRole: "licensed_pharmacist",
    shop: VERIFIED_SHOP_A,
    supabase: pharmacistClient,
  });

  const emitNotification = async (input: {
    shopId: string;
    eventType: string;
    title: string;
    body: string;
    recipientUserId?: string | null;
    entityType?: string | null;
    entityId?: string | null;
  }) => {
    const row = {
      id: nextUuid("99999999"),
      shop_id: input.shopId,
      recipient_user_id: input.recipientUserId ?? null,
      event_type: input.eventType,
      title: input.title,
      body: input.body,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      is_read: false,
      read_at: null,
      created_at: new Date().toISOString(),
    };
    state.notifications.push(row);
    return {
      ok: true as const,
      notification: {
        ...row,
        event_type: row.event_type as import("../src/types/pharmacist").PharmacistNotificationEventType,
      },
    };
  };

  return {
    state,
    patientClient,
    pharmacistClient,
    adminClient,
    pharmacistResolver,
    emitNotification,
  };
}

test("P1/P3 contract compatibility: POST /api/reservations rejects unverified shops and bridges verified reservations + notifications", async () => {
  const env = createSimEnv();

  // Reject unverified shop B
  const unverifiedPayload: CreateReservationRequest = {
    shop_id: SHOP_B,
    prescription_id: null,
    plan_mode: "cheapest",
    items: [{ requested_medicine_id: MED_OTC_ID, allow_alternative: true }],
  };
  const unverifiedRes = await handleCreatePatientReservation(
    unverifiedPayload,
    async () => env.patientClient,
    () => env.adminClient as unknown as ReturnType<typeof import("../src/lib/supabase/server").createAdminClient>,
    env.emitNotification
  );
  assert.equal(unverifiedRes.status, 403);

  // Create valid reservation for verified Shop A with Rx attached
  const validPayload: CreateReservationRequest & {
    items: Array<{ requested_medicine_id: string; allow_alternative: boolean; quantity?: number }>;
  } = {
    shop_id: SHOP_A,
    prescription_id: RX_ID,
    plan_mode: "best_balanced",
    items: [
      { requested_medicine_id: MED_OTC_ID, allow_alternative: true, quantity: 2 },
      { requested_medicine_id: MED_RX_ID, allow_alternative: false, quantity: 1 },
    ],
  };

  const createdRes = await handleCreatePatientReservation(
    validPayload,
    async () => env.patientClient,
    () => env.adminClient as unknown as ReturnType<typeof import("../src/lib/supabase/server").createAdminClient>,
    env.emitNotification
  );
  assert.equal(createdRes.status, 201);
  const createdJson = await createdRes.json();
  assert.equal(createdJson.reservation.shop_id, SHOP_A);
  assert.equal(createdJson.reservation.patient_id, PATIENT_ID);
  assert.equal(createdJson.reservation.prescription_id, RX_ID);
  assert.equal(createdJson.reservation.fulfilment_status, "pending");
  assert.equal(createdJson.items.length, 2);
  assert.equal(createdJson.items[0].inventory_id, INV_OTC_ID);

  // Verify verification queue row & notifications were created
  assert.equal(env.state.verifications.length, 1);
  assert.equal(env.state.verifications[0].status, "pending_review");
  assert.equal(env.state.notifications.length, 2);
  assert.equal(env.state.notifications[0].event_type, "prescription_review");
  assert.equal(env.state.notifications[1].event_type, "reservation_received");

  // Verify patient GET /api/reservations/[id]
  const readRes = await handleGetPatientReservation(
    createdJson.reservation.id,
    async () => env.patientClient
  );
  assert.equal(readRes.status, 200);
  const readJson = await readRes.json();
  assert.equal(readJson.status_history.length, 1);

  // Ensure PharmacistDecisionRequest contract shape remains usable
  const legacyDecisionRef: PharmacistDecisionRequest = {
    reservation_id: createdJson.reservation.id,
    verification_status: "verified",
  };
  assert.equal(legacyDecisionRef.reservation_id, createdJson.reservation.id);
});

test("Schedule H verification gate blocks reservation approval until Rx is verified", async () => {
  const env = createSimEnv();
  const created = await handleCreatePatientReservation(
    {
      shop_id: SHOP_A,
      prescription_id: RX_ID,
      plan_mode: "nearest",
      items: [{ requested_medicine_id: MED_RX_ID, allow_alternative: false, quantity: 2 }],
    },
    async () => env.patientClient,
    () => env.adminClient as unknown as ReturnType<typeof import("../src/lib/supabase/server").createAdminClient>,
    env.emitNotification
  );
  const { reservation } = await created.json();

  // Attempt to approve while prescription_verifications.status === 'pending_review' -> 422
  const blockedApprove = await handleTransitionReservation(
    reservation.id,
    { target_status: "approved" },
    env.pharmacistResolver
  );
  assert.equal(blockedApprove.status, 422);
  const blockedJson = await blockedApprove.json();
  assert.equal(blockedJson.code, "RX_VERIFICATION_REQUIRED");
  assert.equal(env.state.inventory[1].quantity_reserved, 0);

  // Mark prescription verified -> approval succeeds and reserves stock atomically
  env.state.verifications[0].status = "approved";
  const okApprove = await handleTransitionReservation(
    reservation.id,
    { target_status: "approved" },
    env.pharmacistResolver
  );
  assert.equal(okApprove.status, 200);
  assert.equal(env.state.inventory[1].quantity_reserved, 2);
});

test("Atomic stock reservation prevents oversell under concurrent requests, supports release & idempotent fulfillment", async () => {
  const env = createSimEnv();

  // Create two OTC reservations each requesting 4 units (shop only has 5 total!)
  const res1Resp = await handleCreatePatientReservation(
    {
      shop_id: SHOP_A,
      plan_mode: "cheapest",
      items: [{ requested_medicine_id: MED_OTC_ID, allow_alternative: true, quantity: 4 }],
    },
    async () => env.patientClient,
    () => env.adminClient as unknown as ReturnType<typeof import("../src/lib/supabase/server").createAdminClient>,
    env.emitNotification
  );
  const res2Resp = await handleCreatePatientReservation(
    {
      shop_id: SHOP_A,
      plan_mode: "cheapest",
      items: [{ requested_medicine_id: MED_OTC_ID, allow_alternative: true, quantity: 4 }],
    },
    async () => env.patientClient,
    () => env.adminClient as unknown as ReturnType<typeof import("../src/lib/supabase/server").createAdminClient>,
    env.emitNotification
  );
  const res1 = (await res1Resp.json()).reservation;
  const res2 = (await res2Resp.json()).reservation;

  // Approve both concurrently -> only 1 can succeed; the other must get 409 Conflict!
  const [t1, t2] = await Promise.all([
    handleTransitionReservation(
      res1.id,
      { target_status: "approved" },
      env.pharmacistResolver
    ),
    handleTransitionReservation(
      res2.id,
      { target_status: "approved" },
      env.pharmacistResolver
    ),
  ]);
  const statuses = [t1.status, t2.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  assert.equal(env.state.inventory[0].quantity_reserved, 4);
  assert.equal(env.state.inventory[0].quantity_on_hand, 5);

  // Invalid jump: pending -> fulfilled on res2 -> 409 INVALID_TRANSITION
  const invalidJump = await handleTransitionReservation(
    res2.id,
    { target_status: "fulfilled" },
    env.pharmacistResolver
  );
  assert.equal(invalidJump.status, 409);

  // Move res1: approved -> preparing -> ready_for_pickup -> fulfilled
  assert.equal(
    (
      await handleTransitionReservation(
        res1.id,
        { target_status: "preparing" },
        env.pharmacistResolver
      )
    ).status,
    200
  );
  assert.equal(
    (
      await handleTransitionReservation(
        res1.id,
        { target_status: "ready_for_pickup" },
        env.pharmacistResolver
      )
    ).status,
    200
  );
  assert.equal(
    (
      await handleTransitionReservation(
        res1.id,
        { target_status: "fulfilled" },
        env.pharmacistResolver,
        env.emitNotification
      )
    ).status,
    200
  );

  // Low-stock notification was emitted because 1 <= min_stock_threshold (2)
  assert.equal(
    env.state.notifications.some((n) => n.event_type === "low_stock"),
    true
  );

  // Stock deducted once: 5 - 4 = 1 left on hand, 0 reserved, in_stock still true
  assert.equal(env.state.inventory[0].quantity_on_hand, 1);
  assert.equal(env.state.inventory[0].quantity_reserved, 0);
  assert.equal(env.state.inventory[0].in_stock, true);

  // Fulfilled reservation cannot be cancelled or re-fulfilled (idempotent / terminal)
  const postFulfillCancel = await handleTransitionReservation(
    res1.id,
    { target_status: "cancelled", reason: "Too late" },
    env.pharmacistResolver
  );
  assert.equal(postFulfillCancel.status, 409);
  // Direct RPC re-call is also idempotent (never double-deducts!)
  await env.pharmacistClient.rpc("fulfill_reservation_stock", {
    p_reservation_id: res1.id,
  });
  assert.equal(env.state.inventory[0].quantity_on_hand, 1);

  // Partial approve res2 for remaining 1 unit -> cancel releases reserved stock back to ATP
  const res2ItemId = env.state.reservationItems.find(
    (i) => i.reservation_id === res2.id
  )!.id;
  const partialRes2 = await handleTransitionReservation(
    res2.id,
    {
      target_status: "partially_approved",
      item_approvals: [{ reservation_item_id: res2ItemId, approved_qty: 1 }],
    },
    env.pharmacistResolver
  );
  assert.equal(partialRes2.status, 200);
  assert.equal(env.state.inventory[0].quantity_reserved, 1);
  assert.equal(env.state.inventory[0].in_stock, false); // 1 - 1 = 0 ATP!

  const cancelRes2 = await handleTransitionReservation(
    res2.id,
    { target_status: "cancelled", reason: "Patient chose another store" },
    env.pharmacistResolver,
    env.emitNotification
  );
  assert.equal(cancelRes2.status, 200);
  assert.equal(env.state.inventory[0].quantity_reserved, 0);
  assert.equal(env.state.inventory[0].in_stock, true); // ATP restored!
  assert.equal(
    env.state.notifications.some((n) => n.event_type === "reservation_cancelled"),
    true
  );
});

test("Database-backed notifications respect shop scoping and is_read updates", async () => {
  const env = createSimEnv({
    notifications: [
      {
        id: "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        shop_id: SHOP_A,
        recipient_user_id: null,
        event_type: "reservation_received",
        title: "Shop A alert",
        body: "New order",
        entity_type: "reservation",
        entity_id: null,
        is_read: false,
        read_at: null,
        created_at: "2026-11-28T10:00:00Z",
      },
      {
        id: "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        shop_id: SHOP_B,
        recipient_user_id: null,
        event_type: "low_stock",
        title: "Shop B alert",
        body: "Other shop",
        entity_type: "inventory",
        entity_id: null,
        is_read: false,
        read_at: null,
        created_at: "2026-11-28T10:00:00Z",
      },
    ],
  });

  const listRes = await handleListNotifications(
    new URLSearchParams("filter=unread"),
    env.pharmacistResolver
  );
  assert.equal(listRes.status, 200);
  const listJson = await listRes.json();
  assert.equal(listJson.notifications.length, 1);
  assert.equal(listJson.notifications[0].shop_id, SHOP_A);
  assert.equal(listJson.unreadCount, 1);

  const markRes = await handleMarkNotificationsRead(
    { id: "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    env.pharmacistResolver
  );
  assert.equal(markRes.status, 200);
  const markJson = await markRes.json();
  assert.equal(markJson.unreadCount, 0);
  assert.equal(env.state.notifications[0].is_read, true);
  assert.equal(env.state.notifications[1].is_read, false);
});
