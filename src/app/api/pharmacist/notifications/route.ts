/**
 * src/app/api/pharmacist/notifications/route.ts
 *
 * GET /api/pharmacist/notifications   - List shop/user notifications & unread count
 * PATCH /api/pharmacist/notifications - Mark individual or all notifications as read
 */

import { NextRequest } from "next/server";
import {
  handleListNotifications,
  handleMarkNotificationsRead,
} from "@/lib/pharmacist/notification-handlers";

export async function GET(request: NextRequest) {
  return handleListNotifications(request.nextUrl.searchParams);
}

export async function PATCH(request: NextRequest) {
  const rawBody = await request.json().catch(() => null);
  return handleMarkNotificationsRead(rawBody);
}
