/**
 * tests/pharmacist-state-machines.test.ts
 *
 * Unit tests for Phase 3 Pharmacist State Machines, Role Guards & Clinical Integrity:
 * - Reservation fulfilment transitions & mandatory reason enforcement
 * - Legacy order_status compatibility mapping
 * - Prescription verification transitions & owner/licensed_pharmacist vs staff role separation
 * - Mandatory notes on rejection & clarification
 * - NTI Do-Not-Substitute lock & prevention of silent identity/strength/form alterations
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  assertValidReservationTransition,
  assertValidVerificationTransition,
  assertVerificationItemClinicalIntegrity,
  canRoleSignOffVerification,
  canTransitionReservation,
  canTransitionVerification,
  mapFulfilmentToLegacyOrderStatus,
  StateTransitionError,
} from "../src/lib/pharmacist/state-machines";
import {
  prescriptionVerificationDecisionSchema,
  reservationTransitionSchema,
} from "../src/types/pharmacist";

test("Reservation state machine allows valid lifecycle transitions and blocks invalid/terminal ones", () => {
  // Valid happy path
  assert.equal(canTransitionReservation("pending", "under_review"), true);
  assert.equal(canTransitionReservation("under_review", "approved"), true);
  assert.equal(canTransitionReservation("approved", "preparing"), true);
  assert.equal(canTransitionReservation("preparing", "ready_for_pickup"), true);
  assert.equal(canTransitionReservation("ready_for_pickup", "fulfilled"), true);

  // Clarification loop
  assert.equal(canTransitionReservation("under_review", "awaiting_clarification"), true);
  assert.equal(canTransitionReservation("awaiting_clarification", "approved"), true);

  // Invalid jumps & self transitions
  assert.equal(canTransitionReservation("pending", "pending"), false);
  assert.equal(canTransitionReservation("pending", "fulfilled"), false);
  assert.equal(canTransitionReservation("pending", "ready_for_pickup"), false);
  assert.equal(canTransitionReservation("approved", "rejected"), false);

  // Terminal states cannot transition anywhere
  for (const terminal of ["rejected", "fulfilled", "cancelled", "expired"] as const) {
    assert.equal(canTransitionReservation(terminal, "pending"), false);
    assert.equal(canTransitionReservation(terminal, "approved"), false);
    assert.throws(
      () => assertValidReservationTransition(terminal, "under_review", "Reopen"),
      (err: unknown) =>
        err instanceof StateTransitionError && err.code === "INVALID_TRANSITION"
    );
  }
});

test("Reservation transitions enforce mandatory non-empty reasons on rejected, cancelled, and awaiting_clarification", () => {
  for (const statusRequiringReason of [
    "rejected",
    "cancelled",
    "awaiting_clarification",
  ] as const) {
    assert.throws(
      () => assertValidReservationTransition("under_review", statusRequiringReason, ""),
      (err: unknown) =>
        err instanceof StateTransitionError && err.code === "REASON_REQUIRED"
    );
    assert.throws(
      () => assertValidReservationTransition("under_review", statusRequiringReason, "   "),
      (err: unknown) =>
        err instanceof StateTransitionError && err.code === "REASON_REQUIRED"
    );
    assert.doesNotThrow(() =>
      assertValidReservationTransition(
        "under_review",
        statusRequiringReason,
        "Prescription date unclear"
      )
    );
  }

  // Zod schema enforces the same rule
  const invalidParsed = reservationTransitionSchema.safeParse({
    to_status: "rejected",
    reason: "   ",
  });
  assert.equal(invalidParsed.success, false);

  const validParsed = reservationTransitionSchema.safeParse({
    to_status: "rejected",
    reason: "Expired prescription",
  });
  assert.equal(validParsed.success, true);
});

test("mapFulfilmentToLegacyOrderStatus maps all fulfilment statuses cleanly for P1/P3 compatibility", () => {
  assert.equal(mapFulfilmentToLegacyOrderStatus("pending"), "pending");
  assert.equal(mapFulfilmentToLegacyOrderStatus("under_review"), "pending");
  assert.equal(mapFulfilmentToLegacyOrderStatus("awaiting_clarification"), "pending");
  assert.equal(mapFulfilmentToLegacyOrderStatus("approved"), "confirmed");
  assert.equal(mapFulfilmentToLegacyOrderStatus("approved", true), "partial_substitute");
  assert.equal(mapFulfilmentToLegacyOrderStatus("partially_approved"), "partial_substitute");
  assert.equal(mapFulfilmentToLegacyOrderStatus("preparing"), "confirmed");
  assert.equal(mapFulfilmentToLegacyOrderStatus("ready_for_pickup", true), "partial_substitute");
  assert.equal(mapFulfilmentToLegacyOrderStatus("fulfilled"), "picked_up");
  assert.equal(mapFulfilmentToLegacyOrderStatus("rejected"), "declined");
  assert.equal(mapFulfilmentToLegacyOrderStatus("cancelled"), "declined");
  assert.equal(mapFulfilmentToLegacyOrderStatus("expired"), "declined");
});

test("Prescription verification enforces role separation (owner/licensed_pharmacist vs staff) and mandatory notes", () => {
  assert.equal(canRoleSignOffVerification("owner"), true);
  assert.equal(canRoleSignOffVerification("licensed_pharmacist"), true);
  assert.equal(canRoleSignOffVerification("staff"), false);

  // Staff cannot sign off any verification decision
  assert.throws(
    () =>
      assertValidVerificationTransition({
        from: "pending_review",
        to: "approved",
        memberRole: "staff",
      }),
    (err: unknown) =>
      err instanceof StateTransitionError && err.code === "UNAUTHORIZED_ROLE"
  );

  // Missing reason on rejected / needs_clarification
  assert.throws(
    () =>
      assertValidVerificationTransition({
        from: "pending_review",
        to: "rejected",
        memberRole: "licensed_pharmacist",
        reason: "  ",
      }),
    (err: unknown) =>
      err instanceof StateTransitionError && err.code === "REASON_REQUIRED"
  );

  assert.throws(
    () =>
      assertValidVerificationTransition({
        from: "pending_review",
        to: "needs_clarification",
        memberRole: "owner",
        reason: null,
      }),
    (err: unknown) =>
      err instanceof StateTransitionError && err.code === "REASON_REQUIRED"
  );

  // Valid transitions
  assert.doesNotThrow(() =>
    assertValidVerificationTransition({
      from: "pending_review",
      to: "needs_clarification",
      memberRole: "licensed_pharmacist",
      reason: "Dosage frequency for Augmentin is smudged",
    })
  );
  assert.doesNotThrow(() =>
    assertValidVerificationTransition({
      from: "needs_clarification",
      to: "approved",
      memberRole: "owner",
    })
  );

  // Terminal approved/rejected cannot reopen
  assert.equal(canTransitionVerification("approved", "rejected"), false);
  assert.equal(canTransitionVerification("rejected", "approved"), false);

  // Zod schema validation for prescription verification decision
  const zodRejectMissingReason = prescriptionVerificationDecisionSchema.safeParse({
    status: "rejected",
    decision_reason: "",
  });
  assert.equal(zodRejectMissingReason.success, false);

  const zodClarifyWithNote = prescriptionVerificationDecisionSchema.safeParse({
    status: "needs_clarification",
    note: "Confirm strength with prescriber",
  });
  assert.equal(zodClarifyWithNote.success, true);
});

test("NTI Do-Not-Substitute lock and clinical identity/strength/form integrity guards", () => {
  const ntiPrescribed = {
    matched_medicine_id: "11111111-1111-4111-8111-111111111111",
    brand_name: "Thyronorm 50mcg Tablet",
    composition_display: "Levothyroxine Sodium 50mcg",
    strength: "50mcg",
    is_nti: true,
  };

  // Approving NTI as prescribed passes
  assert.doesNotThrow(() =>
    assertVerificationItemClinicalIntegrity(ntiPrescribed, {
      decision: "approved",
    })
  );

  // Any substitution attempt on NTI fails (even if is_nti flag were omitted, via isNtiComposition)
  assert.throws(
    () =>
      assertVerificationItemClinicalIntegrity(
        { ...ntiPrescribed, is_nti: false },
        {
          decision: "substitute_suggested",
          suggested_medicine_id: "22222222-2222-4222-8222-222222222222",
          suggested_brand_name: "Eltroxin 50mcg Tablet",
          suggested_composition_display: "Levothyroxine Sodium 50mcg",
        }
      ),
    (err: unknown) =>
      err instanceof StateTransitionError &&
      err.code === "NTI_SUBSTITUTION_BLOCKED"
  );

  // Silent strength change under 'approved' is blocked
  const nonNtiPrescribed = {
    matched_medicine_id: "33333333-3333-4333-8333-333333333333",
    brand_name: "Dolo 650 Tablet",
    composition_display: "Paracetamol 650mg",
    strength: "650mg",
    dosage_form: "oral_solid",
    is_nti: false,
  };

  assert.throws(
    () =>
      assertVerificationItemClinicalIntegrity(nonNtiPrescribed, {
        decision: "approved",
        suggested_strength: "500mg",
      }),
    (err: unknown) =>
      err instanceof StateTransitionError &&
      err.code === "CLINICAL_IDENTITY_MISMATCH"
  );

  // Silent dosage form change under 'approved' is blocked
  assert.throws(
    () =>
      assertVerificationItemClinicalIntegrity(nonNtiPrescribed, {
        decision: "approved",
        suggested_dosage_form: "oral_liquid",
      }),
    (err: unknown) =>
      err instanceof StateTransitionError &&
      err.code === "CLINICAL_IDENTITY_MISMATCH"
  );

  // Non-NTI compatible same-salt substitution is allowed
  assert.doesNotThrow(() =>
    assertVerificationItemClinicalIntegrity(nonNtiPrescribed, {
      decision: "substitute_suggested",
      suggested_medicine_id: "44444444-4444-4444-8444-444444444444",
      suggested_brand_name: "Calpol 650 Tablet",
      suggested_composition_display: "Paracetamol 650mg",
    })
  );

  // Non-NTI incompatible dosage form substitution (tablet -> syrup) is blocked
  assert.throws(
    () =>
      assertVerificationItemClinicalIntegrity(nonNtiPrescribed, {
        decision: "substitute_suggested",
        suggested_medicine_id: "55555555-5555-4555-8555-555555555555",
        suggested_brand_name: "Calpol Syrup",
        suggested_composition_display: "Paracetamol 650mg",
      }),
    (err: unknown) =>
      err instanceof StateTransitionError &&
      err.code === "CLINICAL_IDENTITY_MISMATCH"
  );
});
