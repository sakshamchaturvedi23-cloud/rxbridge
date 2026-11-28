/**
 * src/lib/pharmacist/state-machines.ts
 *
 * Deterministic reservation fulfilment & prescription verification state machines
 * with mandatory reason enforcement, role authorization checks, and NTI safety guards.
 */

import { isNtiComposition } from "@/lib/clinical/nti-list";
import {
  areDosageFormsCompatible,
  buildCanonicalCompositionKey,
  detectDosageForm,
} from "@/lib/clinical/normalize";
import type { VerificationStatus } from "@/types/contracts";
import type {
  FulfilmentStatus,
  LegacyOrderStatus,
  PharmacistMemberRole,
  PrescriptionVerificationStatus,
} from "@/types/pharmacist";

export class StateTransitionError extends Error {
  public readonly code:
    | "INVALID_TRANSITION"
    | "REASON_REQUIRED"
    | "UNAUTHORIZED_ROLE"
    | "NTI_SUBSTITUTION_BLOCKED"
    | "CLINICAL_IDENTITY_MISMATCH";

  constructor(
    code: StateTransitionError["code"],
    message: string
  ) {
    super(message);
    this.name = "StateTransitionError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// 1. Reservation / Fulfilment State Machine
// ---------------------------------------------------------------------------

export const RESERVATION_TRANSITIONS: Readonly<
  Record<FulfilmentStatus, readonly FulfilmentStatus[]>
> = {
  pending: [
    "under_review",
    "awaiting_clarification",
    "approved",
    "partially_approved",
    "rejected",
    "cancelled",
    "expired",
  ],
  under_review: [
    "awaiting_clarification",
    "approved",
    "partially_approved",
    "rejected",
    "cancelled",
    "expired",
  ],
  awaiting_clarification: [
    "under_review",
    "approved",
    "partially_approved",
    "rejected",
    "cancelled",
    "expired",
  ],
  approved: ["preparing", "ready_for_pickup", "cancelled", "expired"],
  partially_approved: ["preparing", "ready_for_pickup", "cancelled", "expired"],
  preparing: ["ready_for_pickup", "fulfilled", "cancelled"],
  ready_for_pickup: ["fulfilled", "cancelled", "expired"],
  rejected: [],
  fulfilled: [],
  cancelled: [],
  expired: [],
};

export const RESERVATION_REASON_REQUIRED_STATUSES = new Set<FulfilmentStatus>([
  "rejected",
  "cancelled",
  "awaiting_clarification",
]);

export function canTransitionReservation(
  from: FulfilmentStatus,
  to: FulfilmentStatus
): boolean {
  if (from === to) return false;
  const allowed = RESERVATION_TRANSITIONS[from];
  return Boolean(allowed && allowed.includes(to));
}

export function assertValidReservationTransition(
  from: FulfilmentStatus,
  to: FulfilmentStatus,
  reason?: string | null
): void {
  if (!canTransitionReservation(from, to)) {
    throw new StateTransitionError(
      "INVALID_TRANSITION",
      `Invalid reservation transition from '${from}' to '${to}'.`
    );
  }

  if (RESERVATION_REASON_REQUIRED_STATUSES.has(to)) {
    const trimmed = typeof reason === "string" ? reason.trim() : "";
    if (!trimmed) {
      throw new StateTransitionError(
        "REASON_REQUIRED",
        `A non-empty reason is required when transitioning reservation to '${to}'.`
      );
    }
  }
}

/**
 * Maps extended pharmacist fulfilment statuses back to legacy `reservations.order_status`
 * values so existing P1/P3 consumers stay compatible.
 */
export function mapFulfilmentToLegacyOrderStatus(
  status: FulfilmentStatus,
  hasSubstitutions = false
): LegacyOrderStatus {
  switch (status) {
    case "pending":
    case "under_review":
    case "awaiting_clarification":
      return "pending";
    case "partially_approved":
      return "partial_substitute";
    case "approved":
      return hasSubstitutions ? "partial_substitute" : "confirmed";
    case "preparing":
    case "ready_for_pickup":
      return hasSubstitutions ? "partial_substitute" : "confirmed";
    case "fulfilled":
      return "picked_up";
    case "rejected":
    case "cancelled":
    case "expired":
      return "declined";
  }
}

// ---------------------------------------------------------------------------
// 2. Prescription Verification State Machine & Clinical Guards
// ---------------------------------------------------------------------------

export const VERIFICATION_TRANSITIONS: Readonly<
  Record<PrescriptionVerificationStatus, readonly PrescriptionVerificationStatus[]>
> = {
  pending_review: [
    "approved",
    "rejected",
    "needs_clarification",
    "partially_verified",
  ],
  needs_clarification: [
    "pending_review",
    "approved",
    "rejected",
    "partially_verified",
  ],
  partially_verified: ["approved", "rejected", "needs_clarification"],
  approved: [],
  rejected: [],
};

export const VERIFICATION_REASON_REQUIRED_STATUSES =
  new Set<PrescriptionVerificationStatus>(["rejected", "needs_clarification"]);

export const CLINICAL_SIGN_OFF_ROLES: readonly PharmacistMemberRole[] = [
  "owner",
  "licensed_pharmacist",
];

/**
 * Maps Phase 6 verification status to legacy `reservations.verification_status`
 * (`pending | verified | original_required | rejected`).
 */
export function mapVerificationToLegacyStatus(
  status: PrescriptionVerificationStatus
): VerificationStatus {
  switch (status) {
    case "pending_review":
      return "pending";
    case "approved":
    case "partially_verified":
      return "verified";
    case "needs_clarification":
      return "original_required";
    case "rejected":
      return "rejected";
  }
}

export function canRoleSignOffVerification(
  role: PharmacistMemberRole
): boolean {
  return CLINICAL_SIGN_OFF_ROLES.includes(role);
}

export function canTransitionVerification(
  from: PrescriptionVerificationStatus,
  to: PrescriptionVerificationStatus
): boolean {
  if (from === to) return false;
  const allowed = VERIFICATION_TRANSITIONS[from];
  return Boolean(allowed && allowed.includes(to));
}

export function assertValidVerificationTransition(params: {
  from: PrescriptionVerificationStatus;
  to: PrescriptionVerificationStatus;
  memberRole: PharmacistMemberRole;
  reason?: string | null;
}): void {
  const { from, to, memberRole, reason } = params;

  if (!canRoleSignOffVerification(memberRole)) {
    throw new StateTransitionError(
      "UNAUTHORIZED_ROLE",
      `Role '${memberRole}' is not authorized to verify or alter prescription verification status. Only 'owner' or 'licensed_pharmacist' may sign off.`
    );
  }

  if (!canTransitionVerification(from, to)) {
    throw new StateTransitionError(
      "INVALID_TRANSITION",
      `Invalid verification transition from '${from}' to '${to}'.`
    );
  }

  if (VERIFICATION_REASON_REQUIRED_STATUSES.has(to)) {
    const trimmed = typeof reason === "string" ? reason.trim() : "";
    if (!trimmed) {
      throw new StateTransitionError(
        "REASON_REQUIRED",
        `A non-empty pharmacist note/reason is required when marking verification as '${to}'.`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 3. NTI Non-Substitution & Prescribed Identity Integrity Guards
// ---------------------------------------------------------------------------

export interface PrescribedItemSnapshot {
  temp_id?: string;
  matched_medicine_id?: string | null;
  brand_name: string;
  composition_display?: string | null;
  composition_key?: string | null;
  dose?: string | null;
  strength?: string | null;
  dosage_form?: string | null;
  is_nti?: boolean;
}

export interface ProposedItemVerification {
  decision: "approved" | "rejected" | "needs_clarification" | "substitute_suggested";
  allow_substitution?: boolean;
  suggested_medicine_id?: string | null;
  suggested_brand_name?: string | null;
  suggested_composition_display?: string | null;
  suggested_strength?: string | null;
  suggested_dosage_form?: string | null;
  note?: string | null;
}

function normalizeToken(val: string | null | undefined): string {
  return (val ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Enforces NTI Do-Not-Substitute lock and ensures verification decisions never
 * silently alter a prescribed medicine's identity, strength, or dosage form.
 */
export function assertVerificationItemClinicalIntegrity(
  prescribed: PrescribedItemSnapshot,
  proposed: ProposedItemVerification
): void {
  const compText =
    prescribed.composition_display || prescribed.composition_key || "";
  const isNti =
    Boolean(prescribed.is_nti) ||
    isNtiComposition(compText) ||
    isNtiComposition(prescribed.brand_name);

  const hasSuggestedMed =
    Boolean(proposed.suggested_medicine_id) &&
    proposed.suggested_medicine_id !== prescribed.matched_medicine_id;

  const hasDifferentBrand =
    Boolean(proposed.suggested_brand_name?.trim()) &&
    normalizeToken(proposed.suggested_brand_name) !==
      normalizeToken(prescribed.brand_name);

  const isSubstitutionAttempt =
    proposed.decision === "substitute_suggested" ||
    proposed.allow_substitution === true ||
    hasSuggestedMed ||
    hasDifferentBrand;

  if (isNti && isSubstitutionAttempt) {
    throw new StateTransitionError(
      "NTI_SUBSTITUTION_BLOCKED",
      `NTI medicine '${prescribed.brand_name}' cannot be substituted without explicit prescriber authorization.`
    );
  }

  // Prevent silent strength or dosage-form mutation when approving "as prescribed"
  if (proposed.decision === "approved") {
    if (hasSuggestedMed || hasDifferentBrand) {
      throw new StateTransitionError(
        "CLINICAL_IDENTITY_MISMATCH",
        `Cannot silently substitute '${prescribed.brand_name}' under an 'approved' decision; use 'substitute_suggested' instead.`
      );
    }

    const origStrength = normalizeToken(prescribed.strength);
    const propStrength = normalizeToken(proposed.suggested_strength);
    if (origStrength && propStrength && origStrength !== propStrength) {
      throw new StateTransitionError(
        "CLINICAL_IDENTITY_MISMATCH",
        `Cannot silently alter prescribed strength from '${prescribed.strength}' to '${proposed.suggested_strength}'.`
      );
    }

    const origForm =
      prescribed.dosage_form && normalizeToken(prescribed.dosage_form) !== "unknown"
        ? normalizeToken(prescribed.dosage_form)
        : detectDosageForm(prescribed.brand_name, null, compText);
    const propForm =
      proposed.suggested_dosage_form &&
      normalizeToken(proposed.suggested_dosage_form) !== "unknown"
        ? normalizeToken(proposed.suggested_dosage_form)
        : null;

    if (
      propForm &&
      origForm !== "unknown" &&
      propForm !== origForm
    ) {
      throw new StateTransitionError(
        "CLINICAL_IDENTITY_MISMATCH",
        `Cannot silently alter prescribed dosage form from '${origForm}' to '${propForm}'.`
      );
    }
  }

  // For non-NTI explicit substitution suggestions, enforce compatible dosage form & salt
  if (proposed.decision === "substitute_suggested") {
    if (!hasSuggestedMed && !hasDifferentBrand) {
      throw new StateTransitionError(
        "CLINICAL_IDENTITY_MISMATCH",
        `A suggested substitute medicine must be specified when decision is 'substitute_suggested'.`
      );
    }

    if (proposed.suggested_composition_display && compText) {
      const origKey = buildCanonicalCompositionKey(compText);
      const subKey = buildCanonicalCompositionKey(
        proposed.suggested_composition_display
      );
      if (origKey && subKey && origKey !== subKey) {
        throw new StateTransitionError(
          "CLINICAL_IDENTITY_MISMATCH",
          `Suggested substitute composition '${proposed.suggested_composition_display}' does not match prescribed '${compText}'.`
        );
      }
    }

    const origForm = detectDosageForm(
      prescribed.brand_name,
      null,
      compText
    );
    const subForm = detectDosageForm(
      proposed.suggested_brand_name || "",
      null,
      proposed.suggested_composition_display || compText
    );
    if (!areDosageFormsCompatible(origForm, subForm)) {
      throw new StateTransitionError(
        "CLINICAL_IDENTITY_MISMATCH",
        `Incompatible dosage form for substitution: '${origForm}' vs '${subForm}'.`
      );
    }
  }
}

/**
 * Explicit alias for NTI Do-Not-Substitute + identity integrity enforcement.
 */
export function assertNoNtiSubstitution(
  prescribed: PrescribedItemSnapshot,
  proposed: ProposedItemVerification
): void {
  assertVerificationItemClinicalIntegrity(prescribed, proposed);
}
