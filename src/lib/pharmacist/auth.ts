/**
 * src/lib/pharmacist/auth.ts
 *
 * Server-side pharmacist authentication & role/shop verification context guard.
 * Uses only the cookie-based authenticated Supabase client (respects RLS) and
 * never exposes SUPABASE_SERVICE_ROLE_KEY.
 */

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";
import type {
  PharmacistMemberRole,
  PharmacyShopSummary,
  ShopVerificationStatus,
} from "@/types/pharmacist";

export interface RequirePharmacistContextOptions {
  requiredRoles?: readonly PharmacistMemberRole[];
  requireVerifiedShop?: boolean;
}

export interface PharmacistContextSuccess {
  ok: true;
  user: User;
  shopId: string;
  memberRole: PharmacistMemberRole;
  shop: PharmacyShopSummary;
  supabase: SupabaseClient<Database>;
}

export interface PharmacistContextFailure {
  ok: false;
  status: 401 | 403 | 500;
  code:
    | "UNAUTHENTICATED"
    | "NO_ACTIVE_MEMBERSHIP"
    | "INSUFFICIENT_ROLE"
    | "SHOP_NOT_FOUND"
    | "SHOP_NOT_VERIFIED"
    | "INTERNAL_ERROR";
  error: string;
}

export type PharmacistContextResult =
  | PharmacistContextSuccess
  | PharmacistContextFailure;

const ROLE_PRIORITY: Record<PharmacistMemberRole, number> = {
  owner: 1,
  licensed_pharmacist: 2,
  staff: 3,
};

const VALID_MEMBER_ROLES = new Set<string>([
  "owner",
  "licensed_pharmacist",
  "staff",
]);

const VALID_VERIFICATION_STATUSES = new Set<string>([
  "pending",
  "verified",
  "rejected",
  "suspended",
]);

function normalizeVerificationStatus(raw: string): ShopVerificationStatus {
  if (VALID_VERIFICATION_STATUSES.has(raw)) {
    return raw as ShopVerificationStatus;
  }
  return "pending";
}

/**
 * Authenticates the caller via cookie-based Supabase auth and verifies active
 * membership in `pharmacy_members`, optional role restrictions, and optional
 * `verified` shop status.
 */
export async function requirePharmacistContext(
  options: RequirePharmacistContextOptions = {}
): Promise<PharmacistContextResult> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      ok: false,
      status: 401,
      code: "UNAUTHENTICATED",
      error: "Authentication required",
    };
  }

  const { data: memberships, error: memberError } = await supabase
    .from("pharmacy_members")
    .select("id, shop_id, user_id, member_role, is_active, created_at")
    .eq("user_id", user.id)
    .eq("is_active", true);

  if (memberError) {
    return {
      ok: false,
      status: 500,
      code: "INTERNAL_ERROR",
      error: `Failed to verify pharmacy membership: ${memberError.message}`,
    };
  }

  const validMemberships = (memberships ?? []).filter((m) =>
    VALID_MEMBER_ROLES.has(m.member_role)
  );

  if (validMemberships.length === 0) {
    return {
      ok: false,
      status: 403,
      code: "NO_ACTIVE_MEMBERSHIP",
      error: "No active pharmacy membership found for this account",
    };
  }

  // Deterministic role priority if a user belongs to multiple memberships
  validMemberships.sort((a, b) => {
    const roleDiff =
      ROLE_PRIORITY[a.member_role as PharmacistMemberRole] -
      ROLE_PRIORITY[b.member_role as PharmacistMemberRole];
    if (roleDiff !== 0) return roleDiff;
    return (a.created_at || "").localeCompare(b.created_at || "");
  });

  const primary = validMemberships[0];
  const memberRole = primary.member_role as PharmacistMemberRole;
  const shopId = primary.shop_id;

  if (
    options.requiredRoles &&
    options.requiredRoles.length > 0 &&
    !options.requiredRoles.includes(memberRole)
  ) {
    return {
      ok: false,
      status: 403,
      code: "INSUFFICIENT_ROLE",
      error: `Action requires one of the following roles: ${options.requiredRoles.join(", ")}`,
    };
  }

  const { data: shopRow, error: shopError } = await supabase
    .from("shops")
    .select(
      "id, name, shop_type, archetype, address, lat, lng, default_discount_pct, reliability_score, total_requests, confirmed_requests, owner_id, verification_status, verification_note, license_number, pharmacist_reg_number, contact_phone, contact_email, operating_hours, service_radius_km, created_at, updated_at"
    )
    .eq("id", shopId)
    .maybeSingle();

  if (shopError) {
    return {
      ok: false,
      status: 500,
      code: "INTERNAL_ERROR",
      error: `Failed to load pharmacy profile: ${shopError.message}`,
    };
  }

  if (!shopRow) {
    return {
      ok: false,
      status: 403,
      code: "SHOP_NOT_FOUND",
      error: "Assigned pharmacy record could not be accessed",
    };
  }

  const verificationStatus = normalizeVerificationStatus(
    shopRow.verification_status
  );

  if (options.requireVerifiedShop && verificationStatus !== "verified") {
    return {
      ok: false,
      status: 403,
      code: "SHOP_NOT_VERIFIED",
      error: `Pharmacy is currently '${verificationStatus}'. Verification is required for this operation.`,
    };
  }

  const shop: PharmacyShopSummary = {
    ...shopRow,
    verification_status: verificationStatus,
    operating_hours:
      shopRow.operating_hours &&
      typeof shopRow.operating_hours === "object" &&
      !Array.isArray(shopRow.operating_hours)
        ? (shopRow.operating_hours as Record<string, unknown>)
        : null,
  };

  return {
    ok: true,
    user,
    shopId,
    memberRole,
    shop,
    supabase,
  };
}
