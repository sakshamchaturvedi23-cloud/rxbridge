/**
 * src/lib/pharmacist/notification-handlers.ts
 *
 * Testable handlers for Phase 7 database-backed pharmacist notifications.
 */

import { NextResponse } from "next/server";
import { requirePharmacistContext } from "@/lib/pharmacist/auth";
import type { ContextResolver } from "@/lib/pharmacist/onboarding-handlers";
import {
  markNotificationReadSchema,
  type PharmacistNotificationDTO,
  type PharmacistNotificationEventType,
} from "@/types/pharmacist";

/**
 * GET /api/pharmacist/notifications
 */
export async function handleListNotifications(
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

  const filter = (searchParams.get("filter") ?? "all").trim();
  const unreadOnly =
    filter === "unread" || searchParams.get("unreadOnly") === "true";

  let query = ctx.supabase
    .from("pharmacist_notifications")
    .select("*")
    .eq("shop_id", ctx.shopId)
    .or(`recipient_user_id.is.null,recipient_user_id.eq.${ctx.user.id}`)
    .order("created_at", { ascending: false })
    .limit(50);

  if (unreadOnly) {
    query = query.eq("is_read", false);
  }

  const [listRes, countRes] = await Promise.all([
    query,
    ctx.supabase
      .from("pharmacist_notifications")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", ctx.shopId)
      .or(`recipient_user_id.is.null,recipient_user_id.eq.${ctx.user.id}`)
      .eq("is_read", false),
  ]);

  if (listRes.error) {
    return NextResponse.json(
      { error: `Failed to fetch notifications: ${listRes.error.message}` },
      { status: 500 }
    );
  }
  if (countRes.error) {
    return NextResponse.json(
      { error: `Failed to count unread notifications: ${countRes.error.message}` },
      { status: 500 }
    );
  }

  const notifications: PharmacistNotificationDTO[] = (listRes.data ?? []).map(
    (row) => ({
      ...row,
      event_type: row.event_type as PharmacistNotificationEventType,
    })
  );

  return NextResponse.json({
    notifications,
    unreadCount: countRes.count ?? 0,
  });
}

/**
 * PATCH /api/pharmacist/notifications
 */
export async function handleMarkNotificationsRead(
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

  const parsed = markNotificationReadSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid notification read payload",
        details: parsed.error.format(),
      },
      { status: 400 }
    );
  }

  const nowIso = new Date().toISOString();
  const data = parsed.data;

  let updateQuery = ctx.supabase
    .from("pharmacist_notifications")
    .update({ is_read: true, read_at: nowIso })
    .eq("shop_id", ctx.shopId)
    .or(`recipient_user_id.is.null,recipient_user_id.eq.${ctx.user.id}`);

  if (data.markAllRead || data.mark_all) {
    updateQuery = updateQuery.eq("is_read", false);
  } else {
    const ids = Array.from(
      new Set([
        ...(data.id ? [data.id] : []),
        ...(data.notification_ids ?? []),
      ])
    );
    updateQuery = updateQuery.in("id", ids);
  }

  const { error: updateErr } = await updateQuery;
  if (updateErr) {
    return NextResponse.json(
      { error: `Failed to update notifications: ${updateErr.message}` },
      { status: 500 }
    );
  }

  const { count: unreadCount } = await ctx.supabase
    .from("pharmacist_notifications")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", ctx.shopId)
    .or(`recipient_user_id.is.null,recipient_user_id.eq.${ctx.user.id}`)
    .eq("is_read", false);

  return NextResponse.json({
    ok: true,
    unreadCount: unreadCount ?? 0,
  });
}
