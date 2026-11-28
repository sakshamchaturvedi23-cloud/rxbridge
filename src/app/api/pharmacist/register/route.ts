/**
 * src/app/api/pharmacist/register/route.ts
 *
 * POST /api/pharmacist/register
 * Registers a pharmacy under `verification_status: 'pending'`, binds `owner_id`,
 * creates the active `'owner'` record in `pharmacy_members`, and updates `profiles`.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { parsePharmacistRegisterPayload } from "@/lib/pharmacist/onboarding-handlers";
import type { Json } from "@/types/database.types";

export async function POST(request: NextRequest) {
  const rawBody = await request.json().catch(() => null);
  const parsed = parsePharmacistRegisterPayload(rawBody);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid pharmacy registration payload", details: parsed.error.format() },
      { status: 400 }
    );
  }

  const data = parsed.data;
  const lat = data.lat ?? data.latitude!;
  const lng = data.lng ?? data.longitude!;

  const supabase = await createClient();
  const {
    data: { user: existingUser },
  } = await supabase.auth.getUser();

  let userId: string;
  let userFullName = data.full_name?.trim() || "";
  let requiresEmailConfirmation = false;

  if (existingUser) {
    userId = existingUser.id;
    if (!userFullName) {
      userFullName =
        typeof existingUser.user_metadata?.full_name === "string"
          ? existingUser.user_metadata.full_name
          : data.name;
    }
  } else {
    if (!data.email || !data.password || !data.full_name) {
      return NextResponse.json(
        {
          error:
            "Authentication required or provide full_name, email, and password to create a pharmacist account.",
        },
        { status: 401 }
      );
    }

    const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: {
        data: {
          full_name: data.full_name.trim(),
          role: "pharmacist",
        },
      },
    });

    if (signUpError) {
      const msg = signUpError.message.toLowerCase();
      const status = msg.includes("already") || msg.includes("exists") ? 409 : 400;
      return NextResponse.json({ error: signUpError.message }, { status });
    }

    if (!signUpData.user) {
      return NextResponse.json(
        { error: "Failed to create pharmacist user account" },
        { status: 500 }
      );
    }

    userId = signUpData.user.id;
    userFullName = data.full_name.trim();
    requiresEmailConfirmation = !signUpData.session;
  }

  const adminClient = createAdminClient();

  // Prevent duplicate active pharmacy ownership/membership for the same user
  const { data: existingMembership, error: membershipCheckError } = await adminClient
    .from("pharmacy_members")
    .select("id, shop_id")
    .eq("user_id", userId)
    .eq("is_active", true)
    .limit(1);

  if (membershipCheckError) {
    return NextResponse.json(
      { error: `Failed to verify existing memberships: ${membershipCheckError.message}` },
      { status: 500 }
    );
  }

  if (existingMembership && existingMembership.length > 0) {
    return NextResponse.json(
      {
        error: "This account is already associated with an active pharmacy.",
        shop_id: existingMembership[0].shop_id,
      },
      { status: 409 }
    );
  }

  // Create shop strictly in 'pending' verification status
  const { data: createdShop, error: shopError } = await adminClient
    .from("shops")
    .insert({
      name: data.name,
      shop_type: data.shop_type,
      archetype: data.archetype,
      address: data.address,
      lat,
      lng,
      owner_id: userId,
      verification_status: "pending",
      verification_note: null,
      license_number: data.license_number,
      pharmacist_reg_number: data.pharmacist_reg_number,
      contact_phone: data.contact_phone,
      contact_email: data.contact_email,
      operating_hours: (data.operating_hours ?? {}) as Json,
      service_radius_km: data.service_radius_km,
    })
    .select("*")
    .single();

  if (shopError || !createdShop) {
    return NextResponse.json(
      { error: `Failed to register pharmacy: ${shopError?.message || "Insert failed"}` },
      { status: 500 }
    );
  }

  const { error: memberInsertError } = await adminClient
    .from("pharmacy_members")
    .insert({
      shop_id: createdShop.id,
      user_id: userId,
      member_role: "owner",
      is_active: true,
    });

  if (memberInsertError) {
    await adminClient.from("shops").delete().eq("id", createdShop.id);
    return NextResponse.json(
      { error: `Failed to create pharmacy owner membership: ${memberInsertError.message}` },
      { status: 500 }
    );
  }

  const { error: profileUpsertError } = await adminClient
    .from("profiles")
    .upsert(
      {
        id: userId,
        full_name: userFullName || data.name,
        role: "pharmacist",
        assigned_shop_id: createdShop.id,
        trust_label: "Pharmacy onboarding — pending platform verification",
      },
      { onConflict: "id" }
    );

  if (profileUpsertError) {
    console.warn(
      "[pharmacist-register] Profile sync warning:",
      profileUpsertError.message
    );
  }

  return NextResponse.json(
    {
      shop: createdShop,
      memberRole: "owner",
      verificationStatus: "pending",
      requiresEmailConfirmation,
    },
    { status: 201 }
  );
}
