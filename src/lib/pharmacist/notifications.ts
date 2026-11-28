/**
 * src/lib/pharmacist/notifications.ts
 *
 * Server-side database-backed notification helper for the pharmacist portal.
 * Uses `createAdminClient()` strictly in server context with non-throwing failure
 * isolation so notification logging never corrupts primary workflow transactions.
 */

import { createAdminClient } from "@/lib/supabase/server";
import type {
  PharmacistNotificationDTO,
  PharmacistNotificationEventType,
} from "@/types/pharmacist";

export interface CreatePharmacistNotificationInput {
  shopId: string;
  eventType: PharmacistNotificationEventType;
  title: string;
  body: string;
  recipientUserId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}

export type CreatePharmacistNotificationResult =
  | { ok: true; notification: PharmacistNotificationDTO }
  | { ok: false; error: string };

/**
 * Inserts a pharmacist notification into `pharmacist_notifications` using the
 * server-only admin client. Never throws on DB failure so primary business
 * transactions remain unaffected.
 */
export async function createPharmacistNotification(
  input: CreatePharmacistNotificationInput
): Promise<CreatePharmacistNotificationResult> {
  try {
    const adminClient = createAdminClient();

    const { data, error } = await adminClient
      .from("pharmacist_notifications")
      .insert({
        shop_id: input.shopId,
        recipient_user_id: input.recipientUserId ?? null,
        event_type: input.eventType,
        title: input.title.trim(),
        body: input.body.trim(),
        entity_type: input.entityType ?? null,
        entity_id: input.entityId ?? null,
        is_read: false,
      })
      .select("*")
      .single();

    if (error || !data) {
      const msg = error?.message || "Unknown notification insert error";
      console.warn(
        `[pharmacist-notifications] Failed to create '${input.eventType}' notification for shop ${input.shopId}: ${msg}`
      );
      return { ok: false, error: msg };
    }

    return {
      ok: true,
      notification: {
        ...data,
        event_type: data.event_type as PharmacistNotificationEventType,
      },
    };
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Unexpected notification error";
    console.warn(
      `[pharmacist-notifications] Exception creating '${input.eventType}' notification: ${msg}`
    );
    return { ok: false, error: msg };
  }
}
