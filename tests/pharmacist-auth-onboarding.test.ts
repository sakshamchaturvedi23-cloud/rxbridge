/**
 * tests/pharmacist-auth-onboarding.test.ts
 *
 * Phase 4 tests for Pharmacist Auth, Onboarding Validation, Profile Authorization,
 * Self-Promotion Prevention & Dashboard Auth Guards:
 * - Unauthenticated requests to /api/pharmacist/profile & /api/pharmacist/dashboard return 401
 * - Non-owner staff cannot PATCH /api/pharmacist/profile (403)
 * - Owner cannot self-promote verification_status to 'verified' via PATCH (403)
 * - Registration payload validation rejects missing required fields, invalid coordinates, and malformed operating hours
 */

import test from "node:test";
import assert from "node:assert/strict";
import type { User } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database.types";
import type { PharmacistContextResult, RequirePharmacistContextOptions } from "../src/lib/pharmacist/auth";
import {
  handleGetPharmacistDashboard,
  handleGetPharmacistProfile,
  handlePatchPharmacistProfile,
  parsePharmacistRegisterPayload,
} from "../src/lib/pharmacist/onboarding-handlers";
import type { PharmacistMemberRole, PharmacyShopSummary } from "../src/types/pharmacist";

const MOCK_SHOP: PharmacyShopSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Arogya Medicos",
  shop_type: "chemist",
  archetype: "neighborhood",
  address: "14 Main Market, New Delhi",
  lat: 28.6139,
  lng: 77.209,
  default_discount_pct: 0,
  reliability_score: 90,
  total_requests: 0,
  confirmed_requests: 0,
  owner_id: "22222222-2222-4222-8222-222222222222",
  verification_status: "pending",
  verification_note: null,
  license_number: "DL-20B-2026-10421",
  pharmacist_reg_number: "SPC-REG-88241",
  contact_phone: "+91 9876543210",
  contact_email: "desk@arogyamedicos.in",
  operating_hours: { monday: { open: "09:00", close: "21:00", closed: false } },
  service_radius_km: 5,
  created_at: "2026-11-28T10:00:00Z",
  updated_at: "2026-11-28T10:00:00Z",
};

function makeUnauthenticatedResolver() {
  return async (): Promise<PharmacistContextResult> => ({
    ok: false,
    status: 401,
    code: "UNAUTHENTICATED",
    error: "Authentication required",
  });
}

function makeRoleResolver(role: PharmacistMemberRole) {
  return async (
    options?: RequirePharmacistContextOptions
  ): Promise<PharmacistContextResult> => {
    if (options?.requiredRoles && !options.requiredRoles.includes(role)) {
      return {
        ok: false,
        status: 403,
        code: "INSUFFICIENT_ROLE",
        error: `Action requires one of: ${options.requiredRoles.join(", ")}`,
      };
    }
    return {
      ok: true,
      user: { id: "22222222-2222-4222-8222-222222222222" } as User,
      shopId: MOCK_SHOP.id,
      memberRole: role,
      shop: MOCK_SHOP,
      supabase: {} as SupabaseClient<Database>,
    };
  };
}

test("Unauthenticated requests to /api/pharmacist/profile and /api/pharmacist/dashboard return 401", async () => {
  const unauth = makeUnauthenticatedResolver();

  const profileGetRes = await handleGetPharmacistProfile(unauth);
  assert.equal(profileGetRes.status, 401);

  const profilePatchRes = await handlePatchPharmacistProfile(
    { name: "Updated Pharmacy" },
    unauth
  );
  assert.equal(profilePatchRes.status, 401);

  const dashboardGetRes = await handleGetPharmacistDashboard(unauth);
  assert.equal(dashboardGetRes.status, 401);
});

test("Non-owner staff and licensed_pharmacist cannot PATCH /api/pharmacist/profile (403)", async () => {
  const staffRes = await handlePatchPharmacistProfile(
    { name: "Unauthorized Rename" },
    makeRoleResolver("staff")
  );
  assert.equal(staffRes.status, 403);

  const pharmacistRes = await handlePatchPharmacistProfile(
    { name: "Unauthorized Rename" },
    makeRoleResolver("licensed_pharmacist")
  );
  assert.equal(pharmacistRes.status, 403);
});

test("Owner cannot self-promote verification_status or alter owner_id via PATCH /api/pharmacist/profile (403)", async () => {
  const selfVerifyRes = await handlePatchPharmacistProfile(
    { name: "Legit Update", verification_status: "verified" },
    makeRoleResolver("owner")
  );
  assert.equal(selfVerifyRes.status, 403);

  const ownerHijackRes = await handlePatchPharmacistProfile(
    { owner_id: "99999999-9999-4999-8999-999999999999" },
    makeRoleResolver("owner")
  );
  assert.equal(ownerHijackRes.status, 403);

  const noteSpoofRes = await handlePatchPharmacistProfile(
    { verification_note: "Approved by admin" },
    makeRoleResolver("owner")
  );
  assert.equal(noteSpoofRes.status, 403);
});

test("Registration payload validation rejects missing required fields, invalid coordinates, and malformed operating hours", () => {
  const validPayload = {
    full_name: "Dr. Rajesh Sharma",
    email: "owner@arogyamedicos.in",
    password: "StrongPassword123",
    name: "Arogya Medicos",
    shop_type: "chemist",
    archetype: "neighborhood",
    address: "14 Main Market, Sector 12, New Delhi",
    latitude: 28.6139,
    longitude: 77.209,
    service_radius_km: 5,
    contact_phone: "+91 9876543210",
    contact_email: "desk@arogyamedicos.in",
    license_number: "DL-20B-2026-10421",
    pharmacist_reg_number: "SPC-REG-88241",
    operating_hours: {
      monday: { open: "09:00", close: "21:00", closed: false },
      sunday: { open: "09:00", close: "21:00", closed: true },
    },
  };

  assert.equal(parsePharmacistRegisterPayload(validPayload).success, true);

  // Missing license & pharmacist reg numbers
  assert.equal(
    parsePharmacistRegisterPayload({
      ...validPayload,
      license_number: "   ",
    }).success,
    false
  );
  assert.equal(
    parsePharmacistRegisterPayload({
      ...validPayload,
      pharmacist_reg_number: "",
    }).success,
    false
  );

  // Invalid coordinates
  assert.equal(
    parsePharmacistRegisterPayload({
      ...validPayload,
      latitude: 95,
    }).success,
    false
  );
  assert.equal(
    parsePharmacistRegisterPayload({
      ...validPayload,
      longitude: -190,
    }).success,
    false
  );

  // Invalid operating hours time format
  assert.equal(
    parsePharmacistRegisterPayload({
      ...validPayload,
      operating_hours: {
        monday: { open: "9am", close: "9pm", closed: false },
      },
    }).success,
    false
  );

  // Invalid service radius <= 0
  assert.equal(
    parsePharmacistRegisterPayload({
      ...validPayload,
      service_radius_km: 0,
    }).success,
    false
  );
});
