# RxBridge — Pharmacist Side Workflow Handoff

**Branch:** `p2-pharmacist-workflow`  
**Owner:** P2 (AI, Clinical Foundation & Complete Pharmacist Side Workflow)

---

## 1. Architecture & Folder Structure

The Pharmacist Side Workflow is built cleanly inside P2's ownership boundaries without modifying P3's exclusive optimizer/plans modules (`src/app/api/plans/`, `src/lib/optimizer/*`), P1 patient UI (`src/app/(patient)/`, `src/components/patient/`), or P2's existing clinical safety/OCR core (`src/lib/clinical/*`, `/api/extract`, `/api/safety`, `/api/medicines`).

```text
supabase/migrations/
  └── 202611290001_pharmacist_workflow.sql   # Additive schema, RLS hardening & atomic stock RPCs
schema.sql                                   # Mirrored unified database schema
src/types/
  ├── database.types.ts                      # Updated DB Row/Insert/Update/RPC types
  └── pharmacist.ts                          # Pharmacist DTOs, enums, and Zod schemas
src/lib/pharmacist/
  ├── auth.ts                                # requirePharmacistContext() guard (RLS-backed)
  ├── state-machines.ts                      # Reservation & Rx verification state machines + NTI guards
  ├── inventory-service.ts                   # ATP calculations, expiry/status logic, unlinked normalization
  ├── notifications.ts                       # Server-only notification emitter (createAdminClient)
  ├── onboarding-handlers.ts                 # Auth/onboarding/profile/dashboard testable handlers
  ├── inventory-handlers.ts                  # Inventory CRUD, RPC stock adjust & movement handlers
  ├── demand-handlers.ts                     # Privacy-safe demand feed & response handlers
  ├── prescription-handlers.ts               # Rx queue, 300s signed URL doc & clinical sign-off handlers
  ├── reservation-handlers.ts                # Patient bridge + pharmacist fulfilment transition handlers
  └── notification-handlers.ts               # Notifications list & mark-read handlers
src/app/api/
  ├── reservations/
  │   ├── route.ts                           # POST /api/reservations (P1/P3 bridge)
  │   └── [id]/route.ts                      # GET /api/reservations/[id] (patient status read)
  └── pharmacist/
      ├── register/route.ts                  # POST /api/pharmacist/register
      ├── profile/route.ts                   # GET, PATCH /api/pharmacist/profile
      ├── dashboard/route.ts                 # GET /api/pharmacist/dashboard
      ├── inventory/route.ts                 # GET, POST /api/pharmacist/inventory
      ├── inventory/[id]/route.ts            # GET, PATCH, DELETE /api/pharmacist/inventory/[id]
      ├── inventory/[id]/movements/route.ts  # GET /api/pharmacist/inventory/[id]/movements
      ├── demand/route.ts                    # GET /api/pharmacist/demand
      ├── demand/[id]/respond/route.ts       # POST /api/pharmacist/demand/[id]/respond
      ├── prescriptions/route.ts             # GET /api/pharmacist/prescriptions
      ├── prescriptions/[id]/route.ts        # GET /api/pharmacist/prescriptions/[id]
      ├── prescriptions/[id]/document/route.ts # GET /api/pharmacist/prescriptions/[id]/document
      ├── prescriptions/[id]/verify/route.ts # POST /api/pharmacist/prescriptions/[id]/verify
      ├── reservations/route.ts              # GET /api/pharmacist/reservations
      ├── reservations/[id]/transition/route.ts # POST /api/pharmacist/reservations/[id]/transition
      └── notifications/route.ts             # GET, PATCH /api/pharmacist/notifications
src/components/pharmacist/
  ├── PharmacistShell.tsx                    # 7-section responsive shell + role/verification context
  ├── VerificationBanner.tsx                 # Persistent pending/rejected/suspended banner
  ├── NotificationBell.tsx                   # Database-backed notification bell dropdown
  ├── InventoryFormModal.tsx                 # Catalog-linked & manual/unlinked inventory editor
  ├── InventoryMovementsDrawer.tsx           # Stock movement audit ledger drawer
  ├── DemandResponseModal.tsx                # Available / partial / unavailable demand response modal
  ├── PrescriptionViewerPane.tsx             # 300s signed URL document viewer
  ├── VerificationDecisionPanel.tsx          # Safety flags, NTI locks, decision & audit notes
  └── ReservationDetailDrawer.tsx            # Line-item approvals, fulfilment actions & history
src/app/(pharmacist)/
  ├── layout.tsx                             # Next.js 16 <Suspense> wrapper around PharmacistShell
  └── pharmacist/
      ├── login/page.tsx
      ├── register/page.tsx
      ├── dashboard/page.tsx
      ├── inventory/page.tsx
      ├── demand/page.tsx
      ├── prescriptions/page.tsx
      ├── prescriptions/[id]/page.tsx
      ├── reservations/page.tsx
      ├── profile/page.tsx
      └── settings/page.tsx
```

---

## 2. Database Schema, Constraints, RLS Policies & Postgres RPCs

Migration file: `supabase/migrations/202611290001_pharmacist_workflow.sql` (mirrored in `schema.sql`).

### Tables & Extensions
- **`shops`:** Added `owner_id`, `verification_status` (`'pending' | 'verified' | 'rejected' | 'suspended'`, default `'pending'`; pre-existing seeded rows with `owner_id IS NULL` preserved as `'verified'`), `verification_note`, `license_number`, `pharmacist_reg_number`, `contact_phone`, `contact_email`, `operating_hours`, `service_radius_km` (`> 0`), `updated_at`.
- **`pharmacy_members`:** `(id, shop_id, user_id, member_role in ('owner', 'licensed_pharmacist', 'staff'), is_active, created_at, updated_at)`, `unique (shop_id, user_id)`. Added FK `profiles_assigned_shop_id_fkey`.
- **`shop_inventory`:** Nullable `medicine_id`; partial unique index `shop_inventory_active_catalog_uidx` on `(shop_id, medicine_id) where medicine_id is not null and is_archived = false`; `is_catalog_linked`, `custom_*`, `is_rx_required`, `mrp >= 0`, `selling_price >= 0`, `quantity_on_hand >= 0`, `quantity_reserved >= 0`, `quantity_reserved <= quantity_on_hand`, `min_stock_threshold >= 0`, `batch_number`, `expiry_date`, `is_available`, `is_archived`, `archived_at`; trigger `sync_shop_inventory_in_stock()` maintaining `in_stock` for P3 optimizer compatibility.
- **`inventory_movements`:** Immutable ledger `(previous_qty, new_qty, delta_qty, movement_type, actor_id, reservation_id, reason, created_at)`.
- **`pharmacy_medicine_requests` & `pharmacy_demand_responses`:** Privacy-safe area/targeted demand requests and per-shop quotes (`unique (request_id, shop_id)`).
- **`prescription_verifications` & `pharmacist_verification_notes`:** Clinical sign-off records (`unique (prescription_id, shop_id)`) and chronological notes.
- **`reservations`, `reservation_items`, `reservation_status_history`:** Added `fulfilment_status`, `status_reason`, `expires_at`, `inventory_id`, `requested_qty`, `approved_qty`, `stock_reserved_qty`, `stock_deducted`, `item_note`, and transition audit history.
- **`pharmacist_notifications`:** Shop/user notifications (`new_demand`, `prescription_review`, `reservation_received`, `clarification_submitted`, `reservation_cancelled`, `low_stock`).

### RLS & Storage Security
- `public.get_my_shop_id()` resolves active `pharmacy_members` first (fallback to `profiles.assigned_shop_id`).
- `public.is_shop_member(p_shop_id, p_roles)` (`SECURITY DEFINER`, `STABLE`, `SET search_path = public`) enforces role checks cleanly.
- `shops` / `shop_inventory`: Public/patient reads restricted to `verification_status = 'verified'` and non-archived available stock; owners cannot self-promote `verification_status`, `verification_note`, or `owner_id`.
- `prescriptions`: Pharmacists have `SELECT`-only access when linked to an active reservation or verification request; `storage.objects` policies (`storage_patient_*`) remain untouched, and prescription documents are served exclusively via server-side `createAdminClient().storage.from('prescriptions').createSignedUrl(..., 300)`.
- `reservations` / `reservation_items`: Replaced `FOR ALL` patient policies with granular policies restricting patient updates solely to cancellation while `pending`/`under_review`.

### Atomic Postgres RPCs (`FOR UPDATE`, `SECURITY DEFINER`, `SET search_path = public`)
- `adjust_shop_inventory(p_inventory_id, p_delta, p_movement_type, p_reason, p_reservation_id)`
- `reserve_reservation_stock(p_reservation_id, p_item_approvals)` (idempotent delta holds, rejects expired/archived/unavailable/insufficient ATP)
- `release_reservation_stock(p_reservation_id, p_reason)` (idempotent safe release)
- `fulfill_reservation_stock(p_reservation_id)` (idempotent deduction setting `stock_deducted = true`)

---

## 3. Authentication, Roles & Verification Gating

- **Authentication:** `requirePharmacistContext()` in `src/lib/pharmacist/auth.ts` validates the Supabase Auth cookie session (`401` if unauthenticated) and active `pharmacy_members` row (`403` if missing/inactive/wrong role/unverified when `requireVerifiedShop: true`).
- **Roles:**
  - `owner`: Full store profile/settings management, team visibility, inventory, demand, Rx verification, and reservation fulfilment.
  - `licensed_pharmacist`: Clinical Rx verification sign-off, inventory, demand, and reservation fulfilment.
  - `staff`: Inventory, demand, and reservation handling; blocked (`403`) from editing shop profile or signing off clinical prescription verifications.
- **Verification Gating:**
  - Newly registered shops always start in `verification_status: 'pending'` (labeled `"Submitted — pending platform verification"` — never misrepresented as regulator-validated).
  - Unverified (`pending`, `rejected`, `suspended`) shops see a persistent `VerificationBanner` and are blocked (`403`) from `/api/pharmacist/demand*` and `/api/pharmacist/reservations/[id]/transition`.

---

## 4. State Machines & Clinical Safety Rules

### Prescription Verification (`prescription_verifications`)
- Allowed transitions: `pending_review -> approved | rejected | needs_clarification | partially_verified`; `needs_clarification -> pending_review | approved | rejected | partially_verified`; `partially_verified -> approved | rejected | needs_clarification` (`approved` and `rejected` are terminal).
- Role gate: `owner` or `licensed_pharmacist` only (`staff` rejected with `403`).
- Mandatory note/reason required for `rejected` and `needs_clarification`.
- Clinical guards (`assertNoNtiSubstitution` / `assertVerificationItemClinicalIntegrity`):
  - Enforces `isNtiComposition()` Do-Not-Substitute lock.
  - Blocks silent changes to prescribed brand/identity, strength, or incompatible dosage forms (`detectDosageForm`, `areDosageFormsCompatible`).
  - Never mutates `public.prescriptions`.

### Reservation Fulfilment (`reservations.fulfilment_status`)
- Separate from clinical Rx verification.
- Allowed transitions:
  - `pending -> under_review | awaiting_clarification | approved | partially_approved | rejected | cancelled | expired`
  - `under_review -> awaiting_clarification | approved | partially_approved | rejected | cancelled | expired`
  - `awaiting_clarification -> under_review | approved | partially_approved | rejected | cancelled | expired`
  - `approved | partially_approved -> preparing | ready_for_pickup | cancelled | expired`
  - `preparing -> ready_for_pickup | fulfilled | cancelled`
  - `ready_for_pickup -> fulfilled | cancelled | expired`
  - `rejected | fulfilled | cancelled | expired` -> terminal.
- Schedule H gate: Any item with `is_schedule_h`, `is_nti`, or `is_rx_required` blocks transition to `approved | partially_approved | preparing | ready_for_pickup | fulfilled` unless `prescription_verifications.status` is `approved` or `partially_verified` (`422 RX_VERIFICATION_REQUIRED`).
- Legacy `order_status` stays synchronized via `mapFulfilmentToLegacyOrderStatus()`.

---

## 5. API Endpoints & Request/Response Examples

### `POST /api/pharmacist/register`
```json
// Request
{
  "full_name": "Dr. Rajesh Sharma",
  "email": "owner@pharmacy.in",
  "password": "StrongPassword123",
  "name": "Arogya Medicos",
  "shop_type": "chemist",
  "archetype": "neighborhood",
  "address": "14 Main Market, New Delhi",
  "latitude": 28.6139,
  "longitude": 77.2090,
  "service_radius_km": 5,
  "contact_phone": "+91 9876543210",
  "contact_email": "desk@pharmacy.in",
  "license_number": "DL-20B-2026-10421",
  "pharmacist_reg_number": "SPC-REG-88241"
}
// Response 201
{
  "shop": { "id": "...", "verification_status": "pending" },
  "memberRole": "owner",
  "verificationStatus": "pending",
  "requiresEmailConfirmation": false
}
```

### `GET /api/pharmacist/dashboard`
Returns `{ shop, memberRole, kpis: { totalMedicinesListed, totalAvailableItems, lowStockMedicines, outOfStockMedicines, incomingPatientRequests, pendingPrescriptionVerifications, approvedReservations, rejectedRequests, completedFulfilments }, unreadNotifications, lowStockAlerts }`.

### `POST /api/pharmacist/inventory` & `PATCH /api/pharmacist/inventory/[id]`
```json
// Catalog-linked POST
{
  "is_catalog_linked": true,
  "medicine_id": "33333333-3333-4333-8333-333333333333",
  "quantity_on_hand": 25,
  "min_stock_threshold": 5,
  "selling_price": 31.5,
  "batch_number": "DOLO-26A",
  "expiry_date": "2028-01-01"
}
// Stock adjustment PATCH (calls adjust_shop_inventory RPC)
{
  "delta": 10,
  "movement_type": "restock",
  "reason": "Distributor invoice #402"
}
```

### `GET /api/pharmacist/demand` & `POST /api/pharmacist/demand/[id]/respond`
```json
// Respond POST
{
  "availability_status": "partial",
  "available_qty": 2,
  "quoted_unit_price": 185.0,
  "note": "2 strips ready at counter"
}
```

### `POST /api/pharmacist/prescriptions/[id]/verify`
```json
{
  "decision": "approved",
  "note": "Verified signature, date, and dosage instructions.",
  "item_decisions": [
    {
      "temp_id": "item-1",
      "medicine_id": "55555555-5555-4555-8555-555555555555",
      "medicine_name": "Thyronorm 50mcg Tablet",
      "verified": true
    }
  ]
}
```

### `POST /api/reservations` & `POST /api/pharmacist/reservations/[id]/transition`
```json
// POST /api/reservations (P1/P3 CreateReservationRequest compatible)
{
  "shop_id": "11111111-1111-4111-8111-111111111111",
  "prescription_id": "99999999-9999-4999-8999-999999999999",
  "plan_mode": "best_balanced",
  "items": [
    { "requested_medicine_id": "66666666-6666-4666-8666-666666666666", "allow_alternative": false, "quantity": 2 }
  ]
}
// POST /api/pharmacist/reservations/[id]/transition
{
  "target_status": "partially_approved",
  "item_approvals": [
    { "reservation_item_id": "...", "approved_qty": 1, "item_note": "1 strip available" }
  ]
}
```

### `GET, PATCH /api/pharmacist/notifications`
```json
// PATCH mark single or all read
{ "id": "..." }
// or
{ "markAllRead": true }
```

---

## 6. P1 & P3 Integration Contract & Proposed `contracts.ts` Additions

- **Existing `src/types/contracts.ts` exports were kept 100% untouched** (`CreateReservationRequest`, `PharmacistDecisionRequest`, `VerificationStatus`, `ReservationItemStatus`, `StockSource`, `PlanMode`, `SafetyFlag`).
- **Stable IDs preserved across P1/P2/P3:** `patient_id`, `shop_id`, `prescription_id`, `medicine_id` (`requested_medicine_id`), `inventory_id`, `reservation_id`.
- **`shop_inventory.in_stock` compatibility:** P3's optimizer continues reading `shop_inventory.in_stock`, which is kept automatically synchronized by `sync_shop_inventory_in_stock()` (`(quantity_on_hand - quantity_reserved) > 0 AND is_available AND NOT is_archived AND (expiry_date IS NULL OR expiry_date > CURRENT_DATE)`).
- **Proposed non-breaking additions for `src/types/contracts.ts` (for future P1/P3 sync):**
  - Optional `quantity?: number` on `CreateReservationRequest["items"][number]`
  - Optional `FulfilmentStatus` union export mirroring `reservations.fulfilment_status`

---

## 7. How to Run & Test

```bash
# Unit & integration tests (all P2 + Pharmacist suites)
npx tsx --test tests/pharmacist-*.test.ts tests/p2-*.test.ts

# TypeScript check
npx tsc --noEmit

# ESLint
npm run lint

# Next.js 16 production build
npm run build
```

---

## 8. Known Limitations & Notes

1. **Remote Supabase Migration & Type Regeneration:** `supabase` CLI is not installed in this local environment, so `supabase/migrations/202611290001_pharmacist_workflow.sql` must be applied to the target Supabase project (`supabase db push` or SQL Editor), followed by running `npx supabase gen types typescript --remote=hjjnanwlcerxapeugama > src/types/database.types.ts` to cross-verify the manually updated `src/types/database.types.ts`.
2. **Test Environment:** API handler integration tests (`tests/pharmacist-*-api.test.ts`, `tests/pharmacist-reservations-integration.test.ts`) exercise handler logic against deterministic in-memory Supabase/RPC mocks rather than a live remote Supabase instance.
3. **Platform Admin Verification UI:** `shops.verification_status` transitions (`pending` -> `verified` / `rejected` / `suspended`) are intentionally blocked from pharmacy owners via RLS and API guards; platform-admin approval happens via privileged backend/admin tooling (`service_role`).
4. **Demand & Clarification Creation from Patient UI:** Patient-side UI creation of `pharmacy_medicine_requests` (`new_demand`) and patient-side clarification submission (`clarification_submitted`) remain owned by P1; server helpers (`notifyNewDemand`, `notifyClarificationSubmitted`) are ready for P1 integration.
