/**
 * src/types/pharmacist.ts
 *
 * Pharmacist-side domain types, DTOs, and Zod validation schemas.
 * Kept separate from `src/types/contracts.ts` to preserve shared P1/P2/P3 contract stability.
 */

import { z } from "zod";
import type { PlanMode, ReservationItemStatus, SafetyFlag, StockSource, VerificationStatus } from "./contracts";

// ---------------------------------------------------------------------------
// Core Enum / Union Constants
// ---------------------------------------------------------------------------

export const SHOP_VERIFICATION_STATUSES = [
  "pending",
  "verified",
  "rejected",
  "suspended",
] as const;
export type ShopVerificationStatus = (typeof SHOP_VERIFICATION_STATUSES)[number];

export const PHARMACY_MEMBER_ROLES = [
  "owner",
  "licensed_pharmacist",
  "staff",
] as const;
export type PharmacistMemberRole = (typeof PHARMACY_MEMBER_ROLES)[number];

export const INVENTORY_STATUSES = [
  "in_stock",
  "low_stock",
  "out_of_stock",
  "unavailable",
  "expired",
] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

export const INVENTORY_MOVEMENT_TYPES = [
  "initial_stock",
  "restock",
  "manual_adjustment",
  "correction",
  "reservation_hold",
  "reservation_release",
  "reservation_fulfill",
  "expired_writeoff",
  "archive",
] as const;
export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];

export const PRESCRIPTION_VERIFICATION_STATUSES = [
  "pending_review",
  "approved",
  "rejected",
  "needs_clarification",
  "partially_verified",
] as const;
export type PrescriptionVerificationStatus =
  (typeof PRESCRIPTION_VERIFICATION_STATUSES)[number];

export const FULFILMENT_STATUSES = [
  "pending",
  "under_review",
  "awaiting_clarification",
  "approved",
  "partially_approved",
  "rejected",
  "preparing",
  "ready_for_pickup",
  "fulfilled",
  "cancelled",
  "expired",
] as const;
export type FulfilmentStatus = (typeof FULFILMENT_STATUSES)[number];

export const LEGACY_ORDER_STATUSES = [
  "pending",
  "confirmed",
  "partial_substitute",
  "declined",
  "picked_up",
] as const;
export type LegacyOrderStatus = (typeof LEGACY_ORDER_STATUSES)[number];

export const DEMAND_REQUEST_STATUSES = [
  "open",
  "responded",
  "partially_available",
  "unavailable",
  "converted_to_reservation",
  "closed",
] as const;
export type DemandRequestStatus = (typeof DEMAND_REQUEST_STATUSES)[number];

export const DEMAND_AVAILABILITY_STATUSES = [
  "available",
  "partial",
  "unavailable",
] as const;
export type DemandAvailabilityStatus =
  (typeof DEMAND_AVAILABILITY_STATUSES)[number];

export const PHARMACIST_NOTIFICATION_EVENT_TYPES = [
  "new_demand",
  "prescription_review",
  "reservation_received",
  "clarification_submitted",
  "reservation_cancelled",
  "low_stock",
] as const;
export type PharmacistNotificationEventType =
  (typeof PHARMACIST_NOTIFICATION_EVENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Domain DTO Interfaces
// ---------------------------------------------------------------------------

export interface PharmacyShopSummary {
  id: string;
  name: string;
  shop_type: "chemist" | "jan_aushadhi" | string;
  archetype: "neighborhood" | "chain" | "wholesale" | "jan_aushadhi" | string;
  address: string;
  lat: number;
  lng: number;
  default_discount_pct: number;
  reliability_score: number;
  total_requests: number;
  confirmed_requests: number;
  owner_id: string | null;
  verification_status: ShopVerificationStatus;
  verification_note: string | null;
  license_number: string | null;
  pharmacist_reg_number: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  operating_hours: Record<string, unknown> | null;
  service_radius_km: number | null;
  created_at: string | null;
  updated_at: string;
}

export interface PharmacistMemberProfile {
  id: string;
  shop_id: string;
  user_id: string;
  member_role: PharmacistMemberRole;
  is_active: boolean;
  full_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface InventoryItemDTO {
  id: string;
  shop_id: string;
  medicine_id: string | null;
  is_catalog_linked: boolean;
  display_name: string;
  generic_name: string | null;
  composition_display: string | null;
  composition_key: string | null;
  strength: string | null;
  dosage_form: string | null;
  pack_size: string | null;
  manufacturer: string | null;
  is_rx_required: boolean;
  is_nti: boolean;
  is_schedule_h: boolean;
  is_jan_aushadhi: boolean;
  mrp: number | null;
  selling_price: number | null;
  discount_pct: number;
  unit_price?: number | null;
  unit_label?: string | null;
  quantity_on_hand: number;
  quantity_reserved: number;
  available_to_promise: number;
  min_stock_threshold: number;
  batch_number: string | null;
  expiry_date: string | null;
  stock_source: StockSource | string;
  in_stock: boolean;
  is_available: boolean;
  is_archived: boolean;
  status: InventoryStatus;
  is_expired: boolean;
  updated_at: string;
}

export interface InventoryMovementDTO {
  id: string;
  shop_id: string;
  inventory_id: string;
  medicine_id: string | null;
  previous_qty: number;
  new_qty: number;
  delta_qty: number;
  movement_type: InventoryMovementType;
  actor_id: string | null;
  reservation_id: string | null;
  reason: string | null;
  created_at: string;
}

export interface DemandStockMatch {
  inStock: boolean;
  availableQty: number;
  inventoryId: string | null;
  unitPrice: number | null;
  canFulfilFull: boolean;
}

/**
 * Privacy-safe patient demand request DTO for pharmacist views/APIs.
 * Intentionally excludes `patient_id` and any patient PII.
 */
export interface DemandFeedItemDTO {
  id: string;
  target_shop_id: string | null;
  medicine_id: string | null;
  medicine_name: string;
  active_ingredients: string | null;
  strength: string | null;
  dosage_form: string | null;
  requested_qty: number;
  service_area: string | null;
  distance_km: number | null;
  status: DemandRequestStatus;
  created_at: string;
  updated_at: string;
  my_response: DemandResponseDTO | null;
  stock_match: DemandStockMatch;
}

export interface DemandResponseDTO {
  id: string;
  request_id: string;
  shop_id: string;
  responded_by: string | null;
  availability_status: DemandAvailabilityStatus;
  available_qty: number;
  quoted_unit_price: number | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface PrescriptionVerificationItemDecision {
  temp_id: string;
  medicine_id?: string | null;
  brand_name: string;
  decision: "approved" | "rejected" | "needs_clarification" | "substitute_suggested";
  suggested_medicine_id?: string | null;
  suggested_brand_name?: string | null;
  note?: string | null;
}

export interface PrescriptionVerificationDTO {
  id: string;
  prescription_id: string;
  shop_id: string;
  reservation_id: string | null;
  status: PrescriptionVerificationStatus;
  decision_reason: string | null;
  verified_by: string | null;
  verified_at: string | null;
  item_decisions: PrescriptionVerificationItemDecision[];
  created_at: string;
  updated_at: string;
}

export interface VerificationNoteDTO {
  id: string;
  verification_id: string;
  prescription_id: string;
  shop_id: string;
  author_id: string | null;
  decision_snapshot: string;
  note: string;
  created_at: string;
}

export interface ReservationLineItemDTO {
  id: string;
  reservation_id: string;
  requested_medicine_id: string;
  requested_brand_name: string;
  requested_composition: string | null;
  is_nti: boolean;
  is_schedule_h: boolean;
  inventory_id: string | null;
  allow_alternative: boolean;
  item_status: ReservationItemStatus;
  suggested_medicine_id: string | null;
  suggested_brand_name?: string | null;
  requested_qty: number;
  approved_qty: number;
  stock_reserved_qty: number;
  stock_deducted: boolean;
  item_note: string | null;
  final_price: number | null;
  updated_at: string | null;
}

export interface ReservationQueueItemDTO {
  id: string;
  shop_id: string;
  prescription_id: string | null;
  plan_mode: PlanMode | string;
  verification_status: VerificationStatus;
  order_status: LegacyOrderStatus;
  fulfilment_status: FulfilmentStatus;
  status_reason: string | null;
  expires_at: string | null;
  estimated_total: number;
  pharmacist_note: string | null;
  patient_display_label: string;
  items: ReservationLineItemDTO[];
  safety_flags?: SafetyFlag[];
  created_at: string | null;
  updated_at: string;
}

export interface ReservationStatusHistoryDTO {
  id: string;
  reservation_id: string;
  shop_id: string;
  from_status: string | null;
  to_status: string;
  actor_id: string | null;
  actor_role: string | null;
  reason: string | null;
  created_at: string;
}

export interface PharmacistNotificationDTO {
  id: string;
  shop_id: string;
  recipient_user_id: string | null;
  event_type: PharmacistNotificationEventType;
  title: string;
  body: string;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface PharmacistDashboardKPIs {
  pending_rx_reviews: number;
  active_reservations: number;
  ready_for_pickup: number;
  low_stock_count: number;
  out_of_stock_count: number;
  expiring_soon_count: number;
  open_demand_count: number;
  unread_notifications: number;
  fulfilled_today_count: number;
}

export interface PharmacistOverviewKPIs {
  totalMedicinesListed: number;
  totalAvailableItems: number;
  lowStockMedicines: number;
  outOfStockMedicines: number;
  incomingPatientRequests: number;
  pendingPrescriptionVerifications: number;
  approvedReservations: number;
  rejectedRequests: number;
  completedFulfilments: number;
}

export interface LowStockAlertItem {
  id: string;
  displayName: string;
  availableToPromise: number;
  minStockThreshold: number;
  status: InventoryStatus;
}

export interface PharmacistDashboardResponse {
  shop: PharmacyShopSummary;
  memberRole: PharmacistMemberRole;
  kpis: PharmacistOverviewKPIs;
  unreadNotifications: number;
  lowStockAlerts: LowStockAlertItem[];
}

// ---------------------------------------------------------------------------
// Zod Validation Schemas
// ---------------------------------------------------------------------------

const uuidSchema = z.string().uuid("Invalid UUID");
const trimmedNonEmpty = (label: string, max = 500) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be at most ${max} characters`);

const operatingHoursDaySchema = z.object({
  open: z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:MM").optional(),
  close: z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:MM").optional(),
  closed: z.boolean().optional(),
});

export const operatingHoursSchema = z
  .record(z.string(), z.union([operatingHoursDaySchema, z.string(), z.boolean(), z.null()]))
  .optional()
  .default({});

export const shopOnboardingSchema = z.object({
  name: trimmedNonEmpty("Pharmacy name", 160),
  shop_type: z.enum(["chemist", "jan_aushadhi"]).default("chemist"),
  archetype: z
    .enum(["neighborhood", "chain", "wholesale", "jan_aushadhi"])
    .default("neighborhood"),
  address: trimmedNonEmpty("Address", 320),
  lat: z.number().min(-90, "Latitude must be >= -90").max(90, "Latitude must be <= 90"),
  lng: z.number().min(-180, "Longitude must be >= -180").max(180, "Longitude must be <= 180"),
  license_number: trimmedNonEmpty("Drug license number", 80),
  pharmacist_reg_number: trimmedNonEmpty("Pharmacist registration number", 80),
  contact_phone: trimmedNonEmpty("Contact phone", 30),
  contact_email: z.string().trim().email("Valid contact email is required").max(160),
  operating_hours: operatingHoursSchema,
  service_radius_km: z.number().positive("Service radius must be > 0").max(100).default(5),
});
export type ShopOnboardingInput = z.infer<typeof shopOnboardingSchema>;

export const pharmacistRegisterRequestSchema = z
  .object({
    full_name: z.string().trim().min(2, "Full name is required").max(120).optional(),
    email: z.string().trim().email("Valid account email is required").max(160).optional(),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(128)
      .optional(),
    name: trimmedNonEmpty("Pharmacy name", 160),
    shop_type: z.enum(["chemist", "jan_aushadhi"]).default("chemist"),
    archetype: z
      .enum(["neighborhood", "chain", "wholesale", "jan_aushadhi"])
      .default("neighborhood"),
    address: trimmedNonEmpty("Address", 320),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    license_number: trimmedNonEmpty("Drug license number", 80),
    pharmacist_reg_number: trimmedNonEmpty("Pharmacist registration number", 80),
    contact_phone: trimmedNonEmpty("Contact phone", 30),
    contact_email: z.string().trim().email("Valid contact email is required").max(160),
    operating_hours: operatingHoursSchema,
    service_radius_km: z.number().positive("Service radius must be > 0").max(100).default(5),
  })
  .superRefine((val, ctx) => {
    const resolvedLat = val.lat ?? val.latitude;
    const resolvedLng = val.lng ?? val.longitude;
    if (resolvedLat === undefined || !Number.isFinite(resolvedLat)) {
      ctx.addIssue({
        code: "custom",
        path: ["latitude"],
        message: "Valid latitude is required",
      });
    }
    if (resolvedLng === undefined || !Number.isFinite(resolvedLng)) {
      ctx.addIssue({
        code: "custom",
        path: ["longitude"],
        message: "Valid longitude is required",
      });
    }
    const hasAnyCred = Boolean(val.email || val.password);
    if (hasAnyCred && (!val.email || !val.password || !val.full_name)) {
      ctx.addIssue({
        code: "custom",
        path: ["email"],
        message: "full_name, email, and password are all required when creating a new account",
      });
    }
  });
export type PharmacistRegisterRequestInput = z.infer<typeof pharmacistRegisterRequestSchema>;

export const shopSettingsUpdateSchema = shopOnboardingSchema.partial().refine(
  (data) => Object.keys(data).length > 0,
  { message: "At least one field must be provided for update" }
);
export type ShopSettingsUpdateInput = z.infer<typeof shopSettingsUpdateSchema>;

export const pharmacyMemberInviteSchema = z.object({
  user_id: uuidSchema,
  member_role: z.enum(["owner", "licensed_pharmacist", "staff"]),
});
export type PharmacyMemberInviteInput = z.infer<typeof pharmacyMemberInviteSchema>;

export const pharmacyMemberUpdateSchema = z
  .object({
    member_role: z.enum(["owner", "licensed_pharmacist", "staff"]).optional(),
    is_active: z.boolean().optional(),
  })
  .refine(
    (data) => data.member_role !== undefined || data.is_active !== undefined,
    { message: "member_role or is_active is required" }
  );
export type PharmacyMemberUpdateInput = z.infer<typeof pharmacyMemberUpdateSchema>;

const dateOnlyStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expiry date must be YYYY-MM-DD");

export const inventoryCreateSchema = z
  .object({
    is_catalog_linked: z.boolean().default(true),
    medicine_id: uuidSchema.nullable().optional(),
    custom_brand_name: z.string().trim().max(160).nullable().optional(),
    custom_generic_name: z.string().trim().max(160).nullable().optional(),
    custom_composition: z.string().trim().max(320).nullable().optional(),
    custom_strength: z.string().trim().max(80).nullable().optional(),
    custom_dosage_form: z.string().trim().max(80).nullable().optional(),
    custom_pack_size: z.string().trim().max(80).nullable().optional(),
    custom_manufacturer: z.string().trim().max(160).nullable().optional(),
    is_rx_required: z.boolean().optional().default(false),
    mrp: z.number().nonnegative().nullable().optional(),
    selling_price: z.number().nonnegative().nullable().optional(),
    discount_pct: z.number().min(0).max(100).optional().default(0),
    quantity_on_hand: z.number().int().min(0).default(0),
    min_stock_threshold: z.number().int().min(0).default(5),
    batch_number: z.string().trim().max(80).nullable().optional(),
    expiry_date: dateOnlyStringSchema.nullable().optional(),
    is_available: z.boolean().optional().default(true),
  })
  .superRefine((val, ctx) => {
    if (val.is_catalog_linked) {
      if (!val.medicine_id) {
        ctx.addIssue({
          code: "custom",
          path: ["medicine_id"],
          message: "medicine_id is required when is_catalog_linked is true",
        });
      }
    } else {
      if (val.medicine_id) {
        ctx.addIssue({
          code: "custom",
          path: ["medicine_id"],
          message: "medicine_id must be null for unlinked manual entries",
        });
      }
      const hasName =
        Boolean(val.custom_brand_name?.trim()) ||
        Boolean(val.custom_generic_name?.trim());
      if (!hasName) {
        ctx.addIssue({
          code: "custom",
          path: ["custom_brand_name"],
          message:
            "Provide custom_brand_name or custom_generic_name for unlinked manual entries",
        });
      }
    }
  });
export type InventoryCreateInput = z.infer<typeof inventoryCreateSchema>;

export const inventoryUpdateSchema = z
  .object({
    mrp: z.number().nonnegative().nullable().optional(),
    selling_price: z.number().nonnegative().nullable().optional(),
    discount_pct: z.number().min(0).max(100).optional(),
    min_stock_threshold: z.number().int().min(0).optional(),
    batch_number: z.string().trim().max(80).nullable().optional(),
    expiry_date: dateOnlyStringSchema.nullable().optional(),
    is_available: z.boolean().optional(),
    is_archived: z.boolean().optional(),
    is_rx_required: z.boolean().optional(),
    quantity_on_hand: z.number().int().min(0).optional(),
    delta: z.number().int().optional(),
    movement_type: z.enum(INVENTORY_MOVEMENT_TYPES).optional(),
    reason: z.string().trim().max(300).optional(),
    custom_brand_name: z.string().trim().max(160).nullable().optional(),
    custom_generic_name: z.string().trim().max(160).nullable().optional(),
    custom_composition: z.string().trim().max(320).nullable().optional(),
    custom_strength: z.string().trim().max(80).nullable().optional(),
    custom_dosage_form: z.string().trim().max(80).nullable().optional(),
    custom_pack_size: z.string().trim().max(80).nullable().optional(),
    custom_manufacturer: z.string().trim().max(160).nullable().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one inventory field must be provided for update",
  });
export type InventoryUpdateInput = z.infer<typeof inventoryUpdateSchema>;

export const inventoryAdjustSchema = z.object({
  delta: z.number().int().refine((n) => n !== 0, {
    message: "delta must be a non-zero integer",
  }),
  movement_type: z.enum(INVENTORY_MOVEMENT_TYPES),
  reason: z.string().trim().max(300).optional(),
  reservation_id: uuidSchema.nullable().optional(),
});
export type InventoryAdjustInput = z.infer<typeof inventoryAdjustSchema>;

export const demandResponseSchema = z
  .object({
    availability_status: z.enum(DEMAND_AVAILABILITY_STATUSES),
    available_qty: z.number().int().min(0).default(0),
    quoted_unit_price: z.number().nonnegative().nullable().optional(),
    note: z.string().trim().max(400).nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (
      (val.availability_status === "available" ||
        val.availability_status === "partial") &&
      val.available_qty <= 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["available_qty"],
        message: "available_qty must be > 0 when status is available or partial",
      });
    }
    if (val.availability_status === "unavailable" && val.available_qty !== 0) {
      ctx.addIssue({
        code: "custom",
        path: ["available_qty"],
        message: "available_qty must be 0 when status is unavailable",
      });
    }
  });
export type DemandResponseInput = z.infer<typeof demandResponseSchema>;

export const prescriptionVerificationItemDecisionSchema = z.object({
  temp_id: trimmedNonEmpty("temp_id", 80),
  medicine_id: uuidSchema.nullable().optional(),
  brand_name: trimmedNonEmpty("brand_name", 160),
  decision: z.enum([
    "approved",
    "rejected",
    "needs_clarification",
    "substitute_suggested",
  ]),
  suggested_medicine_id: uuidSchema.nullable().optional(),
  suggested_brand_name: z.string().trim().max(160).nullable().optional(),
  note: z.string().trim().max(400).nullable().optional(),
});

export const prescriptionVerificationDecisionSchema = z
  .object({
    status: z.enum(PRESCRIPTION_VERIFICATION_STATUSES),
    decision_reason: z.string().trim().max(600).nullable().optional(),
    note: z.string().trim().max(600).nullable().optional(),
    item_decisions: z
      .array(prescriptionVerificationItemDecisionSchema)
      .optional()
      .default([]),
  })
  .superRefine((val, ctx) => {
    if (
      val.status === "rejected" ||
      val.status === "needs_clarification"
    ) {
      const hasReason =
        Boolean(val.decision_reason?.trim()) || Boolean(val.note?.trim());
      if (!hasReason) {
        ctx.addIssue({
          code: "custom",
          path: ["decision_reason"],
          message: `A non-empty reason or note is required when marking a prescription as '${val.status}'`,
        });
      }
    }
  });
export type PrescriptionVerifyDecisionInput = z.infer<
  typeof prescriptionVerificationDecisionSchema
>;

export const prescriptionVerifyItemInputSchema = z.object({
  temp_id: z.string().trim().max(80).optional(),
  medicine_id: uuidSchema.nullable().optional(),
  medicine_name: trimmedNonEmpty("medicine_name", 160),
  verified: z.boolean(),
  clarification_needed: z.boolean().optional(),
  allow_substitution: z.boolean().optional(),
  suggested_medicine_id: uuidSchema.nullable().optional(),
  suggested_brand_name: z.string().trim().max(160).nullable().optional(),
  suggested_composition_display: z.string().trim().max(320).nullable().optional(),
  suggested_strength: z.string().trim().max(80).nullable().optional(),
  suggested_dosage_form: z.string().trim().max(80).nullable().optional(),
  note: z.string().trim().max(400).nullable().optional(),
});

export const prescriptionVerifyActionSchema = z
  .object({
    decision: z.enum([
      "approved",
      "rejected",
      "needs_clarification",
      "partially_verified",
    ]),
    note: z.string().trim().max(600).nullable().optional(),
    item_decisions: z.array(prescriptionVerifyItemInputSchema).optional().default([]),
  })
  .superRefine((val, ctx) => {
    if (
      (val.decision === "rejected" || val.decision === "needs_clarification") &&
      !val.note?.trim()
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["note"],
        message: `A non-empty note is required when decision is '${val.decision}'`,
      });
    }
  });
export type PrescriptionVerifyActionInput = z.infer<
  typeof prescriptionVerifyActionSchema
>;

export const reservationItemDecisionSchema = z.object({
  reservation_item_id: uuidSchema,
  item_status: z.enum([
    "pending",
    "confirmed",
    "declined",
    "substitute_suggested",
    "substitute_approved",
    "substitute_rejected",
  ]),
  inventory_id: uuidSchema.nullable().optional(),
  suggested_medicine_id: uuidSchema.nullable().optional(),
  approved_qty: z.number().int().min(0).optional(),
  final_price: z.number().nonnegative().nullable().optional(),
  item_note: z.string().trim().max(300).nullable().optional(),
});
export type ReservationItemDecisionInput = z.infer<
  typeof reservationItemDecisionSchema
>;

export const reservationTransitionSchema = z
  .object({
    to_status: z.enum(FULFILMENT_STATUSES),
    reason: z.string().trim().max(600).nullable().optional(),
    pharmacist_note: z.string().trim().max(600).nullable().optional(),
    item_decisions: z.array(reservationItemDecisionSchema).optional(),
  })
  .superRefine((val, ctx) => {
    if (
      val.to_status === "rejected" ||
      val.to_status === "cancelled" ||
      val.to_status === "awaiting_clarification"
    ) {
      const hasReason =
        Boolean(val.reason?.trim()) || Boolean(val.pharmacist_note?.trim());
      if (!hasReason) {
        ctx.addIssue({
          code: "custom",
          path: ["reason"],
          message: `A non-empty reason is required when transitioning reservation to '${val.to_status}'`,
        });
      }
    }
  });
export type ReservationTransitionInput = z.infer<
  typeof reservationTransitionSchema
>;

export const markNotificationReadSchema = z
  .object({
    notification_ids: z.array(uuidSchema).min(1).max(100).optional(),
    mark_all: z.boolean().optional(),
  })
  .refine(
    (val) => Boolean(val.mark_all) || (val.notification_ids?.length ?? 0) > 0,
    { message: "Specify notification_ids or mark_all: true" }
  );
export type MarkNotificationReadInput = z.infer<typeof markNotificationReadSchema>;
