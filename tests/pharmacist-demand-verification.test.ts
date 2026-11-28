/**
 * tests/pharmacist-demand-verification.test.ts
 *
 * Phase 6 tests for Patient Demand Privacy & Verification Workflow:
 * - Demand response privacy sanitization (strips patient_id / PII) & availability validation
 * - Verification role enforcement (staff -> 403, owner/licensed_pharmacist -> allowed)
 * - Mandatory reason enforcement on 'rejected' and 'needs_clarification'
 * - Original prescription immutability & NTI non-substitution lock enforcement
 * - Unauthorized prescription document request (403 when prescription not assigned to shop)
 */

import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "../src/types/database.types";
import type {
  PharmacistContextResult,
  RequirePharmacistContextOptions,
} from "../src/lib/pharmacist/auth";
import {
  handleListDemand,
  handleRespondToDemand,
  sanitizeDemandRequestToDTO,
} from "../src/lib/pharmacist/demand-handlers";
import {
  handleGetPrescriptionDocument,
  handleVerifyPrescription,
} from "../src/lib/pharmacist/prescription-handlers";
import type {
  PharmacistMemberRole,
  PharmacyShopSummary,
} from "../src/types/pharmacist";

const SHOP_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_SHOP_ID = "22222222-2222-4222-8222-222222222222";
const DEMAND_ID = "33333333-3333-4333-8333-333333333333";
const RX_ID = "44444444-4444-4444-8444-444444444444";
const VERIF_ID = "55555555-5555-4555-8555-555555555555";
const USER_ID = "66666666-6666-4666-8666-666666666666";
const PATIENT_ID = "77777777-7777-4777-8777-777777777777";
const MED_ID = "88888888-8888-4888-8888-888888888888";

const VERIFIED_SHOP: PharmacyShopSummary = {
  id: SHOP_ID,
  name: "Verified Care Pharmacy",
  shop_type: "chemist",
  archetype: "neighborhood",
  address: "14 Main Market, Sector 12, New Delhi",
  lat: 28.6139,
  lng: 77.209,
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
  contact_email: "care@pharmacy.in",
  operating_hours: {},
  service_radius_km: 5,
  created_at: "2026-11-28T00:00:00Z",
  updated_at: "2026-11-28T00:00:00Z",
};

test("Demand feed sanitization strips patient_id and PII while preserving anonymized fields", () => {
  const rawWithSensitive = {
    id: DEMAND_ID,
    patient_id: PATIENT_ID,
    patient_phone: "+91 9876543210",
    medical_history: "Diabetes",
    target_shop_id: null,
    medicine_id: MED_ID,
    medicine_name: "Augmentin 625 Duo Tablet",
    active_ingredients: "Amoxicillin 500mg + Clavulanic Acid 125mg",
    strength: "625mg",
    dosage_form: "oral_solid",
    requested_qty: 2,
    service_area: "Sector 12, New Delhi",
    latitude: 28.614,
    longitude: 77.209,
    status: "open",
    created_at: "2026-11-28T09:00:00Z",
    updated_at: "2026-11-28T09:00:00Z",
  };

  const dto = sanitizeDemandRequestToDTO(
    rawWithSensitive,
    0.4,
    null,
    {
      inStock: true,
      availableQty: 10,
      inventoryId: "inv-1",
      unitPrice: 200,
      canFulfilFull: true,
    }
  ) as unknown as Record<string, unknown>;

  assert.equal("patient_id" in dto, false);
  assert.equal("patient_phone" in dto, false);
  assert.equal("medical_history" in dto, false);
  assert.equal("latitude" in dto, false);
  assert.equal("longitude" in dto, false);
  assert.equal(dto.medicine_name, "Augmentin 625 Duo Tablet");
  assert.equal(dto.requested_qty, 2);
});

test("Demand list & respond enforce verified shop and strict availability quantity rules", async () => {
  let upsertedResponse: Record<string, unknown> | null = null;

  const fakeSupabase = {
    from(table: string) {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        or() {
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        upsert(payload: Record<string, unknown>) {
          upsertedResponse = { id: "resp-1", created_at: "2026-11-28T10:00:00Z", ...payload };
          return builder;
        },
        async maybeSingle() {
          if (table === "pharmacy_medicine_requests") {
            return {
              data: {
                id: DEMAND_ID,
                target_shop_id: null,
                medicine_id: MED_ID,
                medicine_name: "Dolo 650",
                active_ingredients: "Paracetamol",
                strength: "650mg",
                dosage_form: "oral_solid",
                requested_qty: 2,
                service_area: "Sector 12",
                latitude: 28.614,
                longitude: 77.21,
                status: "open",
                created_at: "2026-11-28T09:00:00Z",
                updated_at: "2026-11-28T09:00:00Z",
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
        async single() {
          return { data: upsertedResponse, error: null };
        },
        then(resolve: (val: { data: unknown[]; error: null }) => void) {
          if (table === "pharmacy_medicine_requests") {
            resolve({
              data: [
                {
                  id: DEMAND_ID,
                  target_shop_id: null,
                  medicine_id: MED_ID,
                  medicine_name: "Dolo 650",
                  active_ingredients: "Paracetamol",
                  strength: "650mg",
                  dosage_form: "oral_solid",
                  requested_qty: 2,
                  service_area: "Sector 12",
                  latitude: 28.614,
                  longitude: 77.21,
                  status: "open",
                  created_at: "2026-11-28T09:00:00Z",
                  updated_at: "2026-11-28T09:00:00Z",
                },
              ],
              error: null,
            });
            return;
          }
          resolve({ data: [], error: null });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient<Database>;

  const unverifiedResolver = async (
    opts?: RequirePharmacistContextOptions
  ): Promise<PharmacistContextResult> => {
    if (opts?.requireVerifiedShop) {
      return {
        ok: false,
        status: 403,
        code: "SHOP_NOT_VERIFIED",
        error: "Pharmacy is currently 'pending'.",
      };
    }
    return {
      ok: true,
      user: { id: USER_ID } as User,
      shopId: SHOP_ID,
      memberRole: "owner",
      shop: { ...VERIFIED_SHOP, verification_status: "pending" },
      supabase: fakeSupabase,
    };
  };

  assert.equal(
    (await handleListDemand(new URLSearchParams(), unverifiedResolver)).status,
    403
  );

  const verifiedResolver = async (): Promise<PharmacistContextResult> => ({
    ok: true,
    user: { id: USER_ID } as User,
    shopId: SHOP_ID,
    memberRole: "licensed_pharmacist",
    shop: VERIFIED_SHOP,
    supabase: fakeSupabase,
  });

  // Available with qty 0 fails validation
  const badQtyRes = await handleRespondToDemand(
    DEMAND_ID,
    { availability_status: "available", available_qty: 0 },
    verifiedResolver
  );
  assert.equal(badQtyRes.status, 400);

  // Unavailable with qty > 0 fails validation
  const badUnavailRes = await handleRespondToDemand(
    DEMAND_ID,
    { availability_status: "unavailable", available_qty: 2 },
    verifiedResolver
  );
  assert.equal(badUnavailRes.status, 400);

  // Valid partial response succeeds
  const fakeAdmin = () =>
    ({
      from: () => ({
        update: () => ({ eq: async () => ({ error: null }) }),
      }),
    }) as unknown as ReturnType<typeof import("../src/lib/supabase/server").createAdminClient>;

  const goodRes = await handleRespondToDemand(
    DEMAND_ID,
    { availability_status: "partial", available_qty: 1, quoted_unit_price: 30 },
    verifiedResolver,
    fakeAdmin
  );
  assert.equal(goodRes.status, 200);
  const json = await goodRes.json();
  assert.equal(json.response.availability_status, "partial");
  assert.equal(json.requestStatus, "partially_available");
});

test("Prescription verification enforces role (staff -> 403), mandatory notes, immutability, NTI lock, and document 403", async () => {
  let prescriptionsMutated = false;

  const makeMockSupabase = (opts: { assignedToShop: boolean; ntiItem?: boolean }) =>
    ({
      from(table: string) {
        const builder = {
          select() {
            return builder;
          },
          eq() {
            return builder;
          },
          order() {
            return builder;
          },
          limit() {
            return builder;
          },
          insert(payload: Record<string, unknown>) {
            return {
              select: () => ({
                single: async () => ({
                  data: { id: "note-1", created_at: "2026-11-28T11:00:00Z", ...payload },
                  error: null,
                }),
              }),
            };
          },
          update(payload: Record<string, unknown>) {
            if (table === "prescriptions") {
              prescriptionsMutated = true;
            }
            return {
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    single: async () => ({
                      data: {
                        id: VERIF_ID,
                        prescription_id: RX_ID,
                        shop_id: SHOP_ID,
                        reservation_id: null,
                        ...payload,
                      },
                      error: null,
                    }),
                  }),
                }),
              }),
            };
          },
          delete() {
            if (table === "prescriptions") {
              prescriptionsMutated = true;
            }
            return builder;
          },
          async maybeSingle() {
            if (table === "prescription_verifications") {
              return {
                data: opts.assignedToShop
                  ? {
                      id: VERIF_ID,
                      prescription_id: RX_ID,
                      shop_id: SHOP_ID,
                      reservation_id: null,
                      status: "pending_review",
                      decision_reason: null,
                      verified_by: null,
                      verified_at: null,
                      item_decisions: [],
                      created_at: "2026-11-28T10:00:00Z",
                      updated_at: "2026-11-28T10:00:00Z",
                    }
                  : null,
                error: null,
              };
            }
            if (table === "prescriptions") {
              return {
                data: {
                  id: RX_ID,
                  image_url: `${PATIENT_ID}/rx.jpg`,
                  extracted_items: [
                    opts.ntiItem
                      ? {
                          temp_id: "item-1",
                          matched_medicine_id: MED_ID,
                          brand_name: "Thyronorm 50mcg Tablet",
                          composition_display: "Levothyroxine Sodium 50mcg",
                          is_nti: true,
                          is_schedule_h: true,
                        }
                      : {
                          temp_id: "item-1",
                          matched_medicine_id: MED_ID,
                          brand_name: "Augmentin 625 Duo Tablet",
                          composition_display: "Amoxicillin 500mg + Clavulanic Acid 125mg",
                          is_nti: false,
                          is_schedule_h: true,
                        },
                  ],
                },
                error: null,
              };
            }
            return { data: null, error: null };
          },
          then(resolve: (val: { data: unknown[]; error: null }) => void) {
            resolve({ data: [], error: null });
          },
        };
        return builder;
      },
    }) as unknown as SupabaseClient<Database>;

  const makeRoleResolver = (
    role: PharmacistMemberRole,
    supabase: SupabaseClient<Database>
  ) => async (
    options?: RequirePharmacistContextOptions
  ): Promise<PharmacistContextResult> => {
    if (options?.requiredRoles && !options.requiredRoles.includes(role)) {
      return {
        ok: false,
        status: 403,
        code: "INSUFFICIENT_ROLE",
        error: "Forbidden role",
      };
    }
    return {
      ok: true,
      user: { id: USER_ID } as User,
      shopId: SHOP_ID,
      memberRole: role,
      shop: VERIFIED_SHOP,
      supabase,
    };
  };

  // 1. Unauthorized document access when prescription is NOT assigned to shop -> 403
  const unassignedSupabase = makeMockSupabase({ assignedToShop: false });
  const unauthDocRes = await handleGetPrescriptionDocument(
    RX_ID,
    makeRoleResolver("owner", unassignedSupabase)
  );
  assert.equal(unauthDocRes.status, 403);

  // 2. Staff cannot verify -> 403
  const assignedNtiSupabase = makeMockSupabase({
    assignedToShop: true,
    ntiItem: true,
  });
  const staffVerifyRes = await handleVerifyPrescription(
    RX_ID,
    { decision: "approved", item_decisions: [] },
    makeRoleResolver("staff", assignedNtiSupabase)
  );
  assert.equal(staffVerifyRes.status, 403);

  // 3. Rejection / clarification without note -> 400
  const rejectNoNoteRes = await handleVerifyPrescription(
    RX_ID,
    { decision: "rejected", note: "   " },
    makeRoleResolver("licensed_pharmacist", assignedNtiSupabase)
  );
  assert.equal(rejectNoNoteRes.status, 400);

  const clarifyNoNoteRes = await handleVerifyPrescription(
    RX_ID,
    { decision: "needs_clarification", note: "" },
    makeRoleResolver("licensed_pharmacist", assignedNtiSupabase)
  );
  assert.equal(clarifyNoNoteRes.status, 400);

  // 4. NTI substitution attempt -> 422 NTI_SUBSTITUTION_BLOCKED
  const ntiSubRes = await handleVerifyPrescription(
    RX_ID,
    {
      decision: "approved",
      item_decisions: [
        {
          temp_id: "item-1",
          medicine_id: MED_ID,
          medicine_name: "Thyronorm 50mcg Tablet",
          verified: true,
          allow_substitution: true,
          suggested_brand_name: "Eltroxin 50mcg Tablet",
        },
      ],
    },
    makeRoleResolver("licensed_pharmacist", assignedNtiSupabase)
  );
  assert.equal(ntiSubRes.status, 422);
  const ntiErrJson = await ntiSubRes.json();
  assert.equal(ntiErrJson.code, "NTI_SUBSTITUTION_BLOCKED");

  // 5. Valid licensed_pharmacist approval -> 200 and prescriptions table never mutated
  const validVerifyRes = await handleVerifyPrescription(
    RX_ID,
    {
      decision: "approved",
      note: "Verified stamp and doctor signature.",
      item_decisions: [
        {
          temp_id: "item-1",
          medicine_id: MED_ID,
          medicine_name: "Thyronorm 50mcg Tablet",
          verified: true,
        },
      ],
    },
    makeRoleResolver("licensed_pharmacist", assignedNtiSupabase)
  );
  assert.equal(validVerifyRes.status, 200);
  assert.equal(prescriptionsMutated, false);
  assert.notEqual(OTHER_SHOP_ID, SHOP_ID);
});
