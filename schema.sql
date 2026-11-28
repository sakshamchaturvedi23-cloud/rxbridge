-- =====================================================================
-- RxBridge Unified Database Schema + Production RLS + Storage Policies
-- Regenerate types after any change:
-- npx supabase gen types typescript --remote=hjjnanwlcerxapeugama > src/types/database.types.ts
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- PART 1: TABLES & INDEXES
-- ---------------------------------------------------------------------

-- 1. Shops (Local Chemists, Jan Aushadhi Kendras & Onboarded Pharmacies)
create table shops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  shop_type text not null check (shop_type in ('chemist', 'jan_aushadhi')),
  archetype text not null check (archetype in ('neighborhood', 'chain', 'wholesale', 'jan_aushadhi')),
  address text not null,
  lat double precision not null,
  lng double precision not null,
  default_discount_pct numeric(5,2) not null default 0,
  reliability_score numeric(5,2) not null default 90.0,
  total_requests int not null default 0,
  confirmed_requests int not null default 0,
  owner_id uuid references auth.users(id) on delete set null,
  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'verified', 'rejected', 'suspended')),
  verification_note text,
  license_number text,
  pharmacist_reg_number text,
  contact_phone text,
  contact_email text,
  operating_hours jsonb default '{}'::jsonb,
  service_radius_km numeric(6,2) default 5.0 check (service_radius_km > 0),
  created_at timestamptz default now(),
  updated_at timestamptz not null default now()
);
create index idx_shops_verification_status on shops(verification_status);
create index idx_shops_owner_id on shops(owner_id);

-- 2. User Profiles (Phase 1 Auth + Phase 2 Quick Basics + Phase 3 Emergency Card)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'patient' check (role in ('patient', 'pharmacist')),
  full_name text not null,
  blood_group text,
  allergies text[] default '{}',
  chronic_conditions text[] default '{}',
  current_meds text[] default '{}',
  trust_label text not null default 'Patient-uploaded, unverified',
  assigned_shop_id uuid references shops(id) on delete set null, -- set only if role = 'pharmacist'
  created_at timestamptz default now()
);

-- 3. Pharmacy Team Members (Role separation: owner, licensed_pharmacist, staff)
create table pharmacy_members (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  member_role text not null check (member_role in ('owner', 'licensed_pharmacist', 'staff')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (shop_id, user_id)
);
create index idx_pharmacy_members_user_active on pharmacy_members(user_id) where is_active = true;
create index idx_pharmacy_members_shop_active on pharmacy_members(shop_id) where is_active = true;

-- 4. Curated Medicine Catalog (500-1,000 SKUs + Jan Aushadhi generics)
create table medicines (
  id uuid primary key default gen_random_uuid(),
  brand_name text not null,
  manufacturer text,
  pack_size text,
  composition_display text not null,
  composition_key text not null,
  mrp numeric(10,2) not null,
  is_jan_aushadhi boolean not null default false,
  is_nti boolean not null default false,
  is_schedule_h boolean not null default false,
  manually_verified boolean not null default false,
  created_at timestamptz default now()
);
create index idx_medicines_comp_key on medicines(composition_key);
create index idx_medicines_brand on medicines(lower(brand_name));

-- 5. Simulated / Reported / Confirmed Shop Inventory (Catalog-Linked & Manual/Unlinked)
create table shop_inventory (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  medicine_id uuid references medicines(id) on delete cascade,
  in_stock boolean not null default true,
  discount_pct numeric(5,2) not null default 0,
  stock_source text not null default 'simulated'
    check (stock_source in ('simulated', 'pharmacy_reported', 'confirmed')),
  is_catalog_linked boolean not null default true,
  custom_brand_name text,
  custom_generic_name text,
  custom_composition text,
  custom_strength text,
  custom_dosage_form text,
  custom_pack_size text,
  custom_manufacturer text,
  is_rx_required boolean not null default false,
  mrp numeric(10,2) check (mrp is null or mrp >= 0),
  selling_price numeric(10,2) check (selling_price is null or selling_price >= 0),
  quantity_on_hand integer not null default 0 check (quantity_on_hand >= 0),
  quantity_reserved integer not null default 0 check (quantity_reserved >= 0),
  min_stock_threshold integer not null default 5 check (min_stock_threshold >= 0),
  batch_number text,
  expiry_date date,
  is_available boolean not null default true,
  is_archived boolean not null default false,
  archived_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint shop_inventory_qty_reserved_le_on_hand_check check (quantity_reserved <= quantity_on_hand),
  constraint shop_inventory_catalog_or_custom_check check (
    (is_catalog_linked = true and medicine_id is not null)
    or (
      is_catalog_linked = false
      and medicine_id is null
      and coalesce(nullif(trim(custom_brand_name), ''), nullif(trim(custom_generic_name), '')) is not null
    )
  )
);
create unique index shop_inventory_active_catalog_uidx
  on shop_inventory(shop_id, medicine_id)
  where medicine_id is not null and is_archived = false;
create index idx_inventory_med on shop_inventory(medicine_id) where in_stock = true;
create index idx_shop_inventory_shop_active on shop_inventory(shop_id, is_archived, is_available);

-- 6. Prescriptions & OCR Extraction Log (Supports Demo Cache + Trust Checks)
create table prescriptions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references profiles(id) on delete cascade,
  image_url text not null,
  image_hash text,
  extracted_items jsonb not null default '[]',
  trust_checks jsonb not null default '{}',
  confirmed_by_patient boolean not null default false,
  created_at timestamptz default now()
);

-- 7. Reservations (Core Loop + Pharmacist Verification & Fulfilment State Machine)
create table reservations (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references profiles(id) on delete cascade,
  shop_id uuid not null references shops(id) on delete cascade,
  prescription_id uuid references prescriptions(id),
  plan_mode text not null,
  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'verified', 'original_required', 'rejected')),
  order_status text not null default 'pending'
    check (order_status in ('pending', 'confirmed', 'partial_substitute', 'declined', 'picked_up')),
  fulfilment_status text not null default 'pending'
    check (
      fulfilment_status in (
        'pending', 'under_review', 'awaiting_clarification',
        'approved', 'partially_approved', 'rejected',
        'preparing', 'ready_for_pickup', 'fulfilled',
        'cancelled', 'expired'
      )
    ),
  status_reason text,
  expires_at timestamptz,
  estimated_total numeric(10,2) not null default 0,
  pharmacist_note text,
  created_at timestamptz default now(),
  updated_at timestamptz not null default now()
);
create index idx_reservations_shop_fulfilment on reservations(shop_id, fulfilment_status, created_at desc);
create index idx_reservations_patient_created on reservations(patient_id, created_at desc);

-- 8. Line-Item Pharmacist Decisions, Substitute Approvals & Stock Allocation
create table reservation_items (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  requested_medicine_id uuid not null references medicines(id),
  inventory_id uuid references shop_inventory(id) on delete set null,
  allow_alternative boolean not null default false,
  item_status text not null default 'pending'
    check (item_status in (
      'pending', 'confirmed', 'declined',
      'substitute_suggested', 'substitute_approved', 'substitute_rejected'
    )),
  suggested_medicine_id uuid references medicines(id),
  requested_qty integer not null default 1 check (requested_qty > 0),
  approved_qty integer not null default 0 check (approved_qty >= 0),
  stock_reserved_qty integer not null default 0 check (stock_reserved_qty >= 0),
  stock_deducted boolean not null default false,
  item_note text,
  final_price numeric(10,2),
  updated_at timestamptz default now()
);
create index idx_reservation_items_res_id on reservation_items(reservation_id);
create index idx_reservation_items_inv_id on reservation_items(inventory_id);

-- 9. Reservation Status Transition History
create table reservation_status_history (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  shop_id uuid not null references shops(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text,
  reason text,
  created_at timestamptz not null default now()
);
create index idx_res_status_history_res_created on reservation_status_history(reservation_id, created_at desc);

-- 10. Immutable Inventory Audit Ledger
create table inventory_movements (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  inventory_id uuid not null references shop_inventory(id) on delete restrict,
  medicine_id uuid references medicines(id) on delete set null,
  previous_qty integer not null check (previous_qty >= 0),
  new_qty integer not null check (new_qty >= 0),
  delta_qty integer not null,
  movement_type text not null check (
    movement_type in (
      'initial_stock', 'restock', 'manual_adjustment', 'correction',
      'reservation_hold', 'reservation_release', 'reservation_fulfill',
      'expired_writeoff', 'archive'
    )
  ),
  actor_id uuid references auth.users(id) on delete set null,
  reservation_id uuid references reservations(id) on delete set null,
  reason text,
  created_at timestamptz not null default now()
);
create index idx_inventory_movements_shop_created on inventory_movements(shop_id, created_at desc);
create index idx_inventory_movements_inv_created on inventory_movements(inventory_id, created_at desc);

-- 11. Privacy-Safe Patient Medicine Demand Feed & Shop Responses
create table pharmacy_medicine_requests (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid references auth.users(id) on delete set null,
  target_shop_id uuid references shops(id) on delete set null,
  medicine_id uuid references medicines(id) on delete set null,
  medicine_name text not null,
  active_ingredients text,
  strength text,
  dosage_form text,
  requested_qty integer not null default 1 check (requested_qty > 0),
  service_area text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  status text not null default 'open' check (
    status in (
      'open', 'responded', 'partially_available',
      'unavailable', 'converted_to_reservation', 'closed'
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_demand_requests_target_status on pharmacy_medicine_requests(target_shop_id, status, created_at desc);
create index idx_demand_requests_patient_id on pharmacy_medicine_requests(patient_id);

create table pharmacy_demand_responses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references pharmacy_medicine_requests(id) on delete cascade,
  shop_id uuid not null references shops(id) on delete cascade,
  responded_by uuid references auth.users(id) on delete set null,
  availability_status text not null check (availability_status in ('available', 'partial', 'unavailable')),
  available_qty integer not null default 0 check (available_qty >= 0),
  quoted_unit_price numeric(10,2) check (quoted_unit_price is null or quoted_unit_price >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, shop_id)
);
create index idx_demand_responses_shop_created on pharmacy_demand_responses(shop_id, created_at desc);

-- 12. Prescription Verifications & Pharmacist Notes
create table prescription_verifications (
  id uuid primary key default gen_random_uuid(),
  prescription_id uuid not null references prescriptions(id) on delete restrict,
  shop_id uuid not null references shops(id) on delete cascade,
  reservation_id uuid references reservations(id) on delete set null,
  status text not null default 'pending_review' check (
    status in (
      'pending_review', 'approved', 'rejected',
      'needs_clarification', 'partially_verified'
    )
  ),
  decision_reason text,
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  item_decisions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (prescription_id, shop_id)
);
create index idx_rx_verifications_shop_status on prescription_verifications(shop_id, status, created_at desc);
create index idx_rx_verifications_reservation_id on prescription_verifications(reservation_id);

create table pharmacist_verification_notes (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid not null references prescription_verifications(id) on delete cascade,
  prescription_id uuid not null references prescriptions(id) on delete restrict,
  shop_id uuid not null references shops(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  decision_snapshot text not null,
  note text not null,
  created_at timestamptz not null default now()
);
create index idx_rx_notes_verification_created on pharmacist_verification_notes(verification_id, created_at desc);

-- 13. Database-Backed Pharmacist Notifications
create table pharmacist_notifications (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  recipient_user_id uuid references auth.users(id) on delete cascade,
  event_type text not null check (
    event_type in (
      'new_demand', 'prescription_review', 'reservation_received',
      'clarification_submitted', 'reservation_cancelled', 'low_stock'
    )
  ),
  title text not null,
  body text not null,
  entity_type text,
  entity_id uuid,
  is_read boolean not null default false,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_pharmacist_notifications_shop_unread on pharmacist_notifications(shop_id, is_read, created_at desc);

-- 14. Phase G Learning Loop: Patient OCR Corrections
create table ocr_aliases (
  id uuid primary key default gen_random_uuid(),
  raw_text text not null unique,
  matched_medicine_id uuid not null references medicines(id) on delete cascade,
  correction_count int not null default 1,
  updated_at timestamptz default now()
);

-- 15. Phase 3: Old Reports Timeline & Time-Limited QR Share
create table patient_reports (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references profiles(id) on delete cascade,
  file_url text not null,
  report_type text not null,
  report_date date,
  summary text,
  confirmed_by_patient boolean not null default false,
  trust_label text not null default 'Patient-uploaded, unverified',
  created_at timestamptz default now()
);

create table share_tokens (
  token uuid primary key default gen_random_uuid(),
  patient_id uuid not null references profiles(id) on delete cascade,
  scope text not null check (scope in ('doctor_history', 'emergency_card')),
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------
-- PART 2: TRIGGERS & HELPER FUNCTIONS
-- ---------------------------------------------------------------------

create or replace function public.sync_shop_inventory_in_stock()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.in_stock := (new.quantity_on_hand - new.quantity_reserved) > 0
    and new.is_available = true
    and new.is_archived = false
    and (new.expiry_date is null or new.expiry_date > current_date);
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_sync_shop_inventory_in_stock
  before insert or update on public.shop_inventory
  for each row
  execute function public.sync_shop_inventory_in_stock();

create or replace function public.get_my_shop_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (
      select pm.shop_id
      from public.pharmacy_members pm
      where pm.user_id = (select auth.uid())
        and pm.is_active = true
      order by
        case pm.member_role
          when 'owner' then 1
          when 'licensed_pharmacist' then 2
          else 3
        end,
        pm.created_at asc
      limit 1
    ),
    (
      select p.assigned_shop_id
      from public.profiles p
      where p.id = (select auth.uid())
        and p.role = 'pharmacist'
    )
  );
$$;

create or replace function public.is_shop_member(
  p_shop_id uuid,
  p_roles text[] default array['owner', 'licensed_pharmacist', 'staff']
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select (
    p_shop_id is not null
    and (select auth.uid()) is not null
    and (
      exists (
        select 1
        from public.pharmacy_members pm
        where pm.shop_id = p_shop_id
          and pm.user_id = (select auth.uid())
          and pm.is_active = true
          and pm.member_role = any(p_roles)
      )
      or (
        not exists (
          select 1
          from public.pharmacy_members pm_any
          where pm_any.shop_id = p_shop_id
            and pm_any.user_id = (select auth.uid())
        )
        and (
          (
            'owner' = any(p_roles)
            and exists (
              select 1
              from public.shops s
              where s.id = p_shop_id
                and s.owner_id = (select auth.uid())
            )
          )
          or (
            'licensed_pharmacist' = any(p_roles)
            and exists (
              select 1
              from public.profiles p
              where p.id = (select auth.uid())
                and p.role = 'pharmacist'
                and p.assigned_shop_id = p_shop_id
            )
          )
        )
      )
    )
  );
$$;

-- ---------------------------------------------------------------------
-- PART 3: ATOMIC STOCK & RESERVATION RPCs (FOR UPDATE, SECURITY DEFINER)
-- ---------------------------------------------------------------------

create or replace function public.adjust_shop_inventory(
  p_inventory_id uuid,
  p_delta integer,
  p_movement_type text,
  p_reason text default null,
  p_reservation_id uuid default null
)
returns public.shop_inventory
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.shop_inventory%rowtype;
  v_updated public.shop_inventory%rowtype;
  v_prev_qty integer;
  v_new_qty integer;
begin
  if p_movement_type not in (
    'initial_stock', 'restock', 'manual_adjustment', 'correction',
    'reservation_hold', 'reservation_release', 'reservation_fulfill',
    'expired_writeoff', 'archive'
  ) then
    raise exception 'Invalid movement_type: %', p_movement_type;
  end if;

  select * into v_inv
  from public.shop_inventory
  where id = p_inventory_id
  for update;

  if not found then
    raise exception 'Inventory item % not found', p_inventory_id;
  end if;

  if not (
    coalesce(auth.role(), '') = 'service_role'
    or public.is_shop_member(v_inv.shop_id)
  ) then
    raise exception 'Unauthorized: caller is not an active member of shop %', v_inv.shop_id;
  end if;

  v_prev_qty := v_inv.quantity_on_hand;
  v_new_qty := v_prev_qty + p_delta;

  if v_new_qty < 0 then
    raise exception 'Stock cannot become negative (current %, delta %)', v_prev_qty, p_delta;
  end if;

  if v_new_qty < v_inv.quantity_reserved then
    raise exception 'New quantity_on_hand (%) cannot be less than quantity_reserved (%)', v_new_qty, v_inv.quantity_reserved;
  end if;

  update public.shop_inventory
  set quantity_on_hand = v_new_qty
  where id = p_inventory_id
  returning * into v_updated;

  insert into public.inventory_movements (
    shop_id, inventory_id, medicine_id,
    previous_qty, new_qty, delta_qty,
    movement_type, actor_id, reservation_id, reason
  ) values (
    v_inv.shop_id, v_inv.id, v_inv.medicine_id,
    v_prev_qty, v_new_qty, p_delta,
    p_movement_type, auth.uid(), p_reservation_id, p_reason
  );

  return v_updated;
end;
$$;

create or replace function public.reserve_reservation_stock(
  p_reservation_id uuid,
  p_item_approvals jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.reservations%rowtype;
  v_item public.reservation_items%rowtype;
  v_inv public.shop_inventory%rowtype;
  v_approval jsonb;
  v_target_qty integer;
  v_target_inv_id uuid;
  v_delta integer;
  v_release integer;
  v_atp integer;
  v_items_updated integer := 0;
  v_total_reserved_delta integer := 0;
begin
  select * into v_res
  from public.reservations
  where id = p_reservation_id
  for update;

  if not found then
    raise exception 'Reservation % not found', p_reservation_id;
  end if;

  if not (
    coalesce(auth.role(), '') = 'service_role'
    or public.is_shop_member(v_res.shop_id)
  ) then
    raise exception 'Unauthorized: caller is not an active member of shop %', v_res.shop_id;
  end if;

  if p_item_approvals is not null and jsonb_typeof(p_item_approvals) <> 'array' then
    raise exception 'p_item_approvals must be a JSON array';
  end if;

  for v_item in
    select *
    from public.reservation_items
    where reservation_id = p_reservation_id
    order by id
    for update
  loop
    if v_item.stock_deducted then
      continue;
    end if;

    v_target_qty := v_item.approved_qty;
    v_target_inv_id := v_item.inventory_id;

    if p_item_approvals is not null then
      select elem into v_approval
      from jsonb_array_elements(p_item_approvals) as elem
      where (elem->>'reservation_item_id')::uuid = v_item.id
      limit 1;

      if v_approval is not null then
        if v_approval ? 'approved_qty' and nullif(v_approval->>'approved_qty', '') is not null then
          v_target_qty := (v_approval->>'approved_qty')::integer;
        end if;
        if v_approval ? 'inventory_id' and nullif(v_approval->>'inventory_id', '') is not null then
          v_target_inv_id := (v_approval->>'inventory_id')::uuid;
        end if;
      end if;
    end if;

    if v_target_qty < 0 then
      raise exception 'approved_qty cannot be negative for reservation_item %', v_item.id;
    end if;

    if v_target_inv_id is null and v_target_qty > 0 then
      select si.id into v_target_inv_id
      from public.shop_inventory si
      where si.shop_id = v_res.shop_id
        and si.medicine_id = coalesce(v_item.suggested_medicine_id, v_item.requested_medicine_id)
        and si.is_archived = false
      limit 1;

      if v_target_inv_id is null then
        raise exception 'No active shop_inventory row found for reservation_item %', v_item.id;
      end if;
    end if;

    v_delta := v_target_qty - v_item.stock_reserved_qty;

    if v_delta > 0 then
      select * into v_inv
      from public.shop_inventory
      where id = v_target_inv_id
        and shop_id = v_res.shop_id
      for update;

      if not found then
        raise exception 'Inventory item % not found in shop %', v_target_inv_id, v_res.shop_id;
      end if;

      if v_inv.is_archived then
        raise exception 'Cannot reserve archived inventory item %', v_inv.id;
      end if;

      if not v_inv.is_available then
        raise exception 'Cannot reserve unavailable inventory item %', v_inv.id;
      end if;

      if v_inv.expiry_date is not null and v_inv.expiry_date <= current_date then
        raise exception 'Cannot reserve expired inventory item % (expired %)', v_inv.id, v_inv.expiry_date;
      end if;

      v_atp := v_inv.quantity_on_hand - v_inv.quantity_reserved;
      if v_atp < v_delta then
        raise exception 'Insufficient available stock for inventory % (available %, needed %)', v_inv.id, v_atp, v_delta;
      end if;

      update public.shop_inventory
      set quantity_reserved = quantity_reserved + v_delta
      where id = v_inv.id;

      update public.reservation_items
      set
        inventory_id = v_inv.id,
        approved_qty = v_target_qty,
        stock_reserved_qty = v_item.stock_reserved_qty + v_delta,
        updated_at = now()
      where id = v_item.id;

      insert into public.inventory_movements (
        shop_id, inventory_id, medicine_id,
        previous_qty, new_qty, delta_qty,
        movement_type, actor_id, reservation_id, reason
      ) values (
        v_res.shop_id, v_inv.id, v_inv.medicine_id,
        v_atp, v_atp - v_delta, -v_delta,
        'reservation_hold', auth.uid(), p_reservation_id,
        format('Reserved %s unit(s) for reservation %s', v_delta, p_reservation_id)
      );

      v_items_updated := v_items_updated + 1;
      v_total_reserved_delta := v_total_reserved_delta + v_delta;

    elsif v_delta < 0 and v_item.inventory_id is not null then
      v_release := -v_delta;

      select * into v_inv
      from public.shop_inventory
      where id = v_item.inventory_id
        and shop_id = v_res.shop_id
      for update;

      if found then
        v_atp := greatest(0, v_inv.quantity_on_hand - v_inv.quantity_reserved);
        v_release := least(v_release, v_inv.quantity_reserved);

        update public.shop_inventory
        set quantity_reserved = greatest(0, quantity_reserved - v_release)
        where id = v_inv.id;

        insert into public.inventory_movements (
          shop_id, inventory_id, medicine_id,
          previous_qty, new_qty, delta_qty,
          movement_type, actor_id, reservation_id, reason
        ) values (
          v_res.shop_id, v_inv.id, v_inv.medicine_id,
          v_atp, v_atp + v_release, v_release,
          'reservation_release', auth.uid(), p_reservation_id,
          format('Reduced reservation hold by %s unit(s)', v_release)
        );
      end if;

      update public.reservation_items
      set
        approved_qty = v_target_qty,
        stock_reserved_qty = v_target_qty,
        updated_at = now()
      where id = v_item.id;

      v_items_updated := v_items_updated + 1;
      v_total_reserved_delta := v_total_reserved_delta - v_release;

    else
      if v_item.approved_qty <> v_target_qty or v_item.inventory_id is distinct from v_target_inv_id then
        update public.reservation_items
        set
          inventory_id = coalesce(v_target_inv_id, inventory_id),
          approved_qty = v_target_qty,
          updated_at = now()
        where id = v_item.id;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'reservation_id', p_reservation_id,
    'items_updated', v_items_updated,
    'total_reserved_delta', v_total_reserved_delta
  );
end;
$$;

create or replace function public.release_reservation_stock(
  p_reservation_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.reservations%rowtype;
  v_item public.reservation_items%rowtype;
  v_inv public.shop_inventory%rowtype;
  v_release integer;
  v_prev_atp integer;
  v_items_released integer := 0;
  v_total_released_qty integer := 0;
begin
  select * into v_res
  from public.reservations
  where id = p_reservation_id
  for update;

  if not found then
    raise exception 'Reservation % not found', p_reservation_id;
  end if;

  if not (
    coalesce(auth.role(), '') = 'service_role'
    or public.is_shop_member(v_res.shop_id)
  ) then
    raise exception 'Unauthorized: caller is not an active member of shop %', v_res.shop_id;
  end if;

  for v_item in
    select *
    from public.reservation_items
    where reservation_id = p_reservation_id
    order by id
    for update
  loop
    if v_item.stock_reserved_qty <= 0 or v_item.stock_deducted then
      continue;
    end if;

    if v_item.inventory_id is not null then
      select * into v_inv
      from public.shop_inventory
      where id = v_item.inventory_id
        and shop_id = v_res.shop_id
      for update;

      if found then
        v_prev_atp := greatest(0, v_inv.quantity_on_hand - v_inv.quantity_reserved);
        v_release := least(v_item.stock_reserved_qty, v_inv.quantity_reserved);

        update public.shop_inventory
        set quantity_reserved = greatest(0, quantity_reserved - v_release)
        where id = v_inv.id;

        if v_release > 0 then
          insert into public.inventory_movements (
            shop_id, inventory_id, medicine_id,
            previous_qty, new_qty, delta_qty,
            movement_type, actor_id, reservation_id, reason
          ) values (
            v_res.shop_id, v_inv.id, v_inv.medicine_id,
            v_prev_atp, v_prev_atp + v_release, v_release,
            'reservation_release', auth.uid(), p_reservation_id,
            coalesce(p_reason, format('Released %s reserved unit(s)', v_release))
          );
        end if;

        v_total_released_qty := v_total_released_qty + v_release;
      end if;
    end if;

    update public.reservation_items
    set
      stock_reserved_qty = 0,
      updated_at = now()
    where id = v_item.id;

    v_items_released := v_items_released + 1;
  end loop;

  return jsonb_build_object(
    'reservation_id', p_reservation_id,
    'items_released', v_items_released,
    'total_released_qty', v_total_released_qty
  );
end;
$$;

create or replace function public.fulfill_reservation_stock(
  p_reservation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.reservations%rowtype;
  v_item public.reservation_items%rowtype;
  v_inv public.shop_inventory%rowtype;
  v_items_fulfilled integer := 0;
  v_total_deducted_qty integer := 0;
begin
  select * into v_res
  from public.reservations
  where id = p_reservation_id
  for update;

  if not found then
    raise exception 'Reservation % not found', p_reservation_id;
  end if;

  if not (
    coalesce(auth.role(), '') = 'service_role'
    or public.is_shop_member(v_res.shop_id)
  ) then
    raise exception 'Unauthorized: caller is not an active member of shop %', v_res.shop_id;
  end if;

  for v_item in
    select *
    from public.reservation_items
    where reservation_id = p_reservation_id
    order by id
    for update
  loop
    if v_item.stock_deducted or v_item.approved_qty <= 0 then
      continue;
    end if;

    if v_item.inventory_id is null then
      raise exception 'Reservation item % has no linked inventory_id for fulfillment', v_item.id;
    end if;

    select * into v_inv
    from public.shop_inventory
    where id = v_item.inventory_id
      and shop_id = v_res.shop_id
    for update;

    if not found then
      raise exception 'Inventory item % not found in shop %', v_item.inventory_id, v_res.shop_id;
    end if;

    if v_inv.quantity_on_hand < v_item.approved_qty then
      raise exception 'Insufficient quantity_on_hand (%) to fulfill approved_qty (%) for inventory %',
        v_inv.quantity_on_hand, v_item.approved_qty, v_inv.id;
    end if;

    if v_inv.quantity_reserved < v_item.stock_reserved_qty then
      raise exception 'Inventory quantity_reserved (%) is less than item stock_reserved_qty (%) for inventory %',
        v_inv.quantity_reserved, v_item.stock_reserved_qty, v_inv.id;
    end if;

    if (v_inv.quantity_on_hand - v_item.approved_qty) < (v_inv.quantity_reserved - v_item.stock_reserved_qty) then
      raise exception 'Fulfilling unreserved quantity would violate remaining reserved stock invariant for inventory %', v_inv.id;
    end if;

    update public.shop_inventory
    set
      quantity_on_hand = quantity_on_hand - v_item.approved_qty,
      quantity_reserved = quantity_reserved - v_item.stock_reserved_qty
    where id = v_inv.id;

    update public.reservation_items
    set
      stock_deducted = true,
      stock_reserved_qty = 0,
      updated_at = now()
    where id = v_item.id;

    insert into public.inventory_movements (
      shop_id, inventory_id, medicine_id,
      previous_qty, new_qty, delta_qty,
      movement_type, actor_id, reservation_id, reason
    ) values (
      v_res.shop_id, v_inv.id, v_inv.medicine_id,
      v_inv.quantity_on_hand, v_inv.quantity_on_hand - v_item.approved_qty, -v_item.approved_qty,
      'reservation_fulfill', auth.uid(), p_reservation_id,
      format('Fulfilled %s unit(s) for reservation %s', v_item.approved_qty, p_reservation_id)
    );

    v_items_fulfilled := v_items_fulfilled + 1;
    v_total_deducted_qty := v_total_deducted_qty + v_item.approved_qty;
  end loop;

  return jsonb_build_object(
    'reservation_id', p_reservation_id,
    'items_fulfilled', v_items_fulfilled,
    'total_deducted_qty', v_total_deducted_qty
  );
end;
$$;

-- ---------------------------------------------------------------------
-- PART 4: ROW-LEVEL SECURITY (RLS) POLICIES
-- ---------------------------------------------------------------------

alter table profiles enable row level security;
alter table pharmacy_members enable row level security;
alter table medicines enable row level security;
alter table shops enable row level security;
alter table shop_inventory enable row level security;
alter table inventory_movements enable row level security;
alter table pharmacy_medicine_requests enable row level security;
alter table pharmacy_demand_responses enable row level security;
alter table prescriptions enable row level security;
alter table prescription_verifications enable row level security;
alter table pharmacist_verification_notes enable row level security;
alter table reservations enable row level security;
alter table reservation_items enable row level security;
alter table reservation_status_history enable row level security;
alter table pharmacist_notifications enable row level security;
alter table ocr_aliases enable row level security;
alter table patient_reports enable row level security;
alter table share_tokens enable row level security;

create policy "profiles_self_select" on profiles for select using ((select auth.uid()) = id);
create policy "profiles_self_insert" on profiles for insert with check ((select auth.uid()) = id);
create policy "profiles_self_update" on profiles for update using ((select auth.uid()) = id);

create policy "medicines_read" on medicines for select to authenticated using (true);

create policy "shops_verified_read" on shops
  for select to authenticated
  using (
    verification_status = 'verified'
    or owner_id = (select auth.uid())
    or public.is_shop_member(id)
  );

create policy "shops_owner_insert" on shops
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and verification_status = 'pending'
  );

create policy "shops_owner_update" on shops
  for update to authenticated
  using (
    public.is_shop_member(id, array['owner'])
    or owner_id = (select auth.uid())
  )
  with check (
    (public.is_shop_member(id, array['owner']) or owner_id = (select auth.uid()))
    and owner_id is not distinct from (
      select s.owner_id from public.shops s where s.id = shops.id
    )
    and verification_status = (
      select s.verification_status from public.shops s where s.id = shops.id
    )
    and verification_note is not distinct from (
      select s.verification_note from public.shops s where s.id = shops.id
    )
  );

create policy "pharmacy_members_select" on pharmacy_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_shop_member(shop_id)
  );

create policy "pharmacy_members_owner_insert" on pharmacy_members
  for insert to authenticated
  with check (
    public.is_shop_member(shop_id, array['owner'])
    or exists (
      select 1 from public.shops s
      where s.id = shop_id
        and s.owner_id = (select auth.uid())
    )
  );

create policy "pharmacy_members_owner_update" on pharmacy_members
  for update to authenticated
  using (public.is_shop_member(shop_id, array['owner']))
  with check (public.is_shop_member(shop_id, array['owner']));

create policy "inventory_public_verified_read" on shop_inventory
  for select to authenticated
  using (
    public.is_shop_member(shop_id)
    or (
      is_archived = false
      and is_available = true
      and exists (
        select 1 from public.shops s
        where s.id = shop_inventory.shop_id
          and s.verification_status = 'verified'
      )
    )
  );

create policy "inventory_member_insert" on shop_inventory
  for insert to authenticated
  with check (public.is_shop_member(shop_id));

create policy "inventory_member_update" on shop_inventory
  for update to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

create policy "inventory_movements_member_select" on inventory_movements
  for select to authenticated
  using (public.is_shop_member(shop_id));

create policy "inventory_movements_member_insert" on inventory_movements
  for insert to authenticated
  with check (
    public.is_shop_member(shop_id)
    and (actor_id is null or actor_id = (select auth.uid()))
  );

create policy "demand_requests_patient_select" on pharmacy_medicine_requests
  for select to authenticated
  using (patient_id = (select auth.uid()));

create policy "demand_requests_patient_insert" on pharmacy_medicine_requests
  for insert to authenticated
  with check (
    patient_id = (select auth.uid())
    and status = 'open'
  );

create policy "demand_requests_patient_update" on pharmacy_medicine_requests
  for update to authenticated
  using (patient_id = (select auth.uid()))
  with check (patient_id = (select auth.uid()));

create policy "demand_requests_verified_shop_select" on pharmacy_medicine_requests
  for select to authenticated
  using (
    (
      status in ('open', 'responded', 'partially_available')
      and exists (
        select 1 from public.shops s
        where s.id = public.get_my_shop_id()
          and s.verification_status = 'verified'
          and public.is_shop_member(s.id)
          and (
            pharmacy_medicine_requests.target_shop_id is null
            or pharmacy_medicine_requests.target_shop_id = s.id
          )
      )
    )
    or exists (
      select 1 from public.pharmacy_demand_responses pdr
      join public.shops s on s.id = pdr.shop_id
      where pdr.request_id = pharmacy_medicine_requests.id
        and s.verification_status = 'verified'
        and public.is_shop_member(pdr.shop_id)
    )
  );

create policy "demand_responses_select" on pharmacy_demand_responses
  for select to authenticated
  using (
    public.is_shop_member(shop_id)
    or exists (
      select 1 from public.pharmacy_medicine_requests r
      where r.id = pharmacy_demand_responses.request_id
        and r.patient_id = (select auth.uid())
    )
  );

create policy "demand_responses_verified_shop_insert" on pharmacy_demand_responses
  for insert to authenticated
  with check (
    public.is_shop_member(shop_id)
    and exists (
      select 1 from public.shops s
      where s.id = shop_id
        and s.verification_status = 'verified'
    )
    and (responded_by is null or responded_by = (select auth.uid()))
    and exists (
      select 1 from public.pharmacy_medicine_requests r
      where r.id = request_id
        and (r.target_shop_id is null or r.target_shop_id = shop_id)
    )
  );

create policy "demand_responses_verified_shop_update" on pharmacy_demand_responses
  for update to authenticated
  using (
    public.is_shop_member(shop_id)
    and exists (
      select 1 from public.shops s
      where s.id = shop_id
        and s.verification_status = 'verified'
    )
  )
  with check (
    public.is_shop_member(shop_id)
    and exists (
      select 1 from public.shops s
      where s.id = shop_id
        and s.verification_status = 'verified'
    )
  );

create policy "rx_patient_all" on prescriptions
  for all to authenticated
  using ((select auth.uid()) = patient_id)
  with check ((select auth.uid()) = patient_id);

create policy "rx_pharmacist_read_assigned" on prescriptions
  for select to authenticated
  using (
    exists (
      select 1 from public.reservations r
      where r.prescription_id = prescriptions.id
        and public.is_shop_member(r.shop_id)
        and r.fulfilment_status not in ('cancelled', 'expired')
    )
    or exists (
      select 1 from public.prescription_verifications pv
      where pv.prescription_id = prescriptions.id
        and public.is_shop_member(pv.shop_id)
    )
  );

create policy "rx_verifications_select" on prescription_verifications
  for select to authenticated
  using (
    public.is_shop_member(shop_id)
    or exists (
      select 1 from public.prescriptions p
      where p.id = prescription_verifications.prescription_id
        and p.patient_id = (select auth.uid())
    )
  );

create policy "rx_verifications_pharmacist_insert" on prescription_verifications
  for insert to authenticated
  with check (
    public.is_shop_member(shop_id, array['owner', 'licensed_pharmacist'])
    and (verified_by is null or verified_by = (select auth.uid()))
  );

create policy "rx_verifications_pharmacist_update" on prescription_verifications
  for update to authenticated
  using (public.is_shop_member(shop_id, array['owner', 'licensed_pharmacist']))
  with check (public.is_shop_member(shop_id, array['owner', 'licensed_pharmacist']));

create policy "rx_notes_select" on pharmacist_verification_notes
  for select to authenticated
  using (public.is_shop_member(shop_id));

create policy "rx_notes_pharmacist_insert" on pharmacist_verification_notes
  for insert to authenticated
  with check (
    public.is_shop_member(shop_id, array['owner', 'licensed_pharmacist'])
    and (author_id is null or author_id = (select auth.uid()))
  );

create policy "res_patient_select" on reservations
  for select to authenticated
  using ((select auth.uid()) = patient_id);

create policy "res_patient_insert" on reservations
  for insert to authenticated
  with check (
    (select auth.uid()) = patient_id
    and verification_status = 'pending'
    and order_status = 'pending'
    and fulfilment_status = 'pending'
    and exists (
      select 1 from public.shops s
      where s.id = shop_id
        and s.verification_status = 'verified'
    )
  );

create policy "res_patient_cancel" on reservations
  for update to authenticated
  using (
    (select auth.uid()) = patient_id
    and fulfilment_status in ('pending', 'under_review')
    and order_status = 'pending'
  )
  with check (
    (select auth.uid()) = patient_id
    and fulfilment_status = 'cancelled'
    and order_status = 'pending'
    and verification_status = (
      select r.verification_status from public.reservations r where r.id = reservations.id
    )
    and estimated_total = (
      select r.estimated_total from public.reservations r where r.id = reservations.id
    )
    and shop_id = (
      select r.shop_id from public.reservations r where r.id = reservations.id
    )
    and patient_id = (
      select r.patient_id from public.reservations r where r.id = reservations.id
    )
  );

create policy "res_pharmacist_select" on reservations
  for select to authenticated
  using (public.is_shop_member(shop_id));

create policy "res_pharmacist_update" on reservations
  for update to authenticated
  using (public.is_shop_member(shop_id))
  with check (public.is_shop_member(shop_id));

create policy "res_items_patient_select" on reservation_items
  for select to authenticated
  using (
    exists (
      select 1 from public.reservations r
      where r.id = reservation_items.reservation_id
        and r.patient_id = (select auth.uid())
    )
  );

create policy "res_items_patient_insert" on reservation_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.reservations r
      where r.id = reservation_items.reservation_id
        and r.patient_id = (select auth.uid())
        and r.fulfilment_status = 'pending'
    )
    and item_status = 'pending'
    and approved_qty = 0
    and stock_reserved_qty = 0
    and stock_deducted = false
    and final_price is null
  );

create policy "res_items_pharmacist_select" on reservation_items
  for select to authenticated
  using (
    exists (
      select 1 from public.reservations r
      where r.id = reservation_items.reservation_id
        and public.is_shop_member(r.shop_id)
    )
  );

create policy "res_items_pharmacist_update" on reservation_items
  for update to authenticated
  using (
    exists (
      select 1 from public.reservations r
      where r.id = reservation_items.reservation_id
        and public.is_shop_member(r.shop_id)
    )
  )
  with check (
    exists (
      select 1 from public.reservations r
      where r.id = reservation_items.reservation_id
        and public.is_shop_member(r.shop_id)
    )
  );

create policy "res_history_select" on reservation_status_history
  for select to authenticated
  using (
    public.is_shop_member(shop_id)
    or exists (
      select 1 from public.reservations r
      where r.id = reservation_status_history.reservation_id
        and r.patient_id = (select auth.uid())
    )
  );

create policy "res_history_insert" on reservation_status_history
  for insert to authenticated
  with check (
    public.is_shop_member(shop_id)
    and (actor_id is null or actor_id = (select auth.uid()))
  );

create policy "notifications_member_select" on pharmacist_notifications
  for select to authenticated
  using (
    public.is_shop_member(shop_id)
    and (recipient_user_id is null or recipient_user_id = (select auth.uid()))
  );

create policy "notifications_member_update" on pharmacist_notifications
  for update to authenticated
  using (
    public.is_shop_member(shop_id)
    and (recipient_user_id is null or recipient_user_id = (select auth.uid()))
  )
  with check (
    public.is_shop_member(shop_id)
    and (recipient_user_id is null or recipient_user_id = (select auth.uid()))
  );

create policy "aliases_read" on ocr_aliases for select to authenticated using (true);

create policy "reports_patient_all" on patient_reports
  for all to authenticated
  using ((select auth.uid()) = patient_id)
  with check ((select auth.uid()) = patient_id);

create policy "tokens_patient_all" on share_tokens
  for all to authenticated
  using ((select auth.uid()) = patient_id)
  with check ((select auth.uid()) = patient_id);

-- ---------------------------------------------------------------------
-- PART 5: PRIVATE STORAGE BUCKET POLICIES (prescriptions & reports)
-- ---------------------------------------------------------------------

create policy "storage_patient_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('prescriptions', 'reports')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "storage_patient_select" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('prescriptions', 'reports')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "storage_patient_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('prescriptions', 'reports')
    and (storage.foldername(name))[1] = auth.uid()::text
  );
