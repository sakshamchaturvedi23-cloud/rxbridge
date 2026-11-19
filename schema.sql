-- =====================================================================
-- RxBridge Unified Database Schema + Production RLS + Storage Policies
-- Regenerate types after any change:
-- npx supabase gen types typescript --remote=hjjnanwlcerxapeugama > src/types/database.types.ts
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- PART 1: TABLES & INDEXES
-- ---------------------------------------------------------------------

-- 1. User Profiles (Phase 1 Auth + Phase 2 Quick Basics + Phase 3 Emergency Card)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'patient' check (role in ('patient', 'pharmacist')),
  full_name text not null,
  blood_group text,
  allergies text[] default '{}',
  chronic_conditions text[] default '{}',
  current_meds text[] default '{}',
  trust_label text not null default 'Patient-uploaded, unverified',
  assigned_shop_id uuid, -- set only if role = 'pharmacist'
  created_at timestamptz default now()
);

-- 2. Curated Medicine Catalog (500-1,000 SKUs + Jan Aushadhi generics)
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

-- 3. Shops (17-18 Local Chemists + 2-3 Real Jan Aushadhi Kendras)
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
  created_at timestamptz default now()
);

-- 4. Simulated / Reported / Confirmed Shop Inventory
create table shop_inventory (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  medicine_id uuid not null references medicines(id) on delete cascade,
  in_stock boolean not null default true,
  discount_pct numeric(5,2) not null default 0,
  stock_source text not null default 'simulated'
    check (stock_source in ('simulated', 'pharmacy_reported', 'confirmed')),
  updated_at timestamptz default now(),
  unique (shop_id, medicine_id)
);
create index idx_inventory_med on shop_inventory(medicine_id) where in_stock = true;

-- 5. Prescriptions & OCR Extraction Log (Supports Demo Cache + Trust Checks)
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

-- 6. Reservations (Phase 1 Core Loop + Phase 2 Pharmacist Verify)
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
  estimated_total numeric(10,2) not null default 0,
  pharmacist_note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 7. Line-Item Pharmacist Decisions & Substitute Approvals
create table reservation_items (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservations(id) on delete cascade,
  requested_medicine_id uuid not null references medicines(id),
  allow_alternative boolean not null default false,
  item_status text not null default 'pending'
    check (item_status in (
      'pending', 'confirmed', 'declined',
      'substitute_suggested', 'substitute_approved', 'substitute_rejected'
    )),
  suggested_medicine_id uuid references medicines(id),
  final_price numeric(10,2),
  updated_at timestamptz default now()
);

-- 8. Phase G Learning Loop: Patient OCR Corrections
create table ocr_aliases (
  id uuid primary key default gen_random_uuid(),
  raw_text text not null unique,
  matched_medicine_id uuid not null references medicines(id) on delete cascade,
  correction_count int not null default 1,
  updated_at timestamptz default now()
);

-- 9. Phase 3: Old Reports Timeline & Time-Limited QR Share
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
-- PART 2: ROW-LEVEL SECURITY (RLS) POLICIES
-- ---------------------------------------------------------------------

create or replace function public.get_my_shop_id()
returns uuid
language sql
security definer
stable
as $$
  select assigned_shop_id
  from public.profiles
  where id = auth.uid() and role = 'pharmacist';
$$;

alter table profiles enable row level security;
alter table medicines enable row level security;
alter table shops enable row level security;
alter table shop_inventory enable row level security;
alter table prescriptions enable row level security;
alter table reservations enable row level security;
alter table reservation_items enable row level security;
alter table ocr_aliases enable row level security;
alter table patient_reports enable row level security;
alter table share_tokens enable row level security;

create policy "profiles_self_select" on profiles for select using (auth.uid() = id);
create policy "profiles_self_insert" on profiles for insert with check (auth.uid() = id);
create policy "profiles_self_update" on profiles for update using (auth.uid() = id);

create policy "medicines_read" on medicines for select to authenticated using (true);
create policy "shops_read" on shops for select to authenticated using (true);
create policy "inventory_read" on shop_inventory for select to authenticated using (true);
create policy "inventory_pharmacist_update" on shop_inventory
  for update to authenticated
  using (shop_id = public.get_my_shop_id())
  with check (shop_id = public.get_my_shop_id());

create policy "rx_patient_all" on prescriptions
  for all to authenticated
  using (auth.uid() = patient_id)
  with check (auth.uid() = patient_id);

create policy "rx_pharmacist_read_assigned" on prescriptions
  for select to authenticated
  using (
    exists (
      select 1 from reservations r
      where r.prescription_id = prescriptions.id
        and r.shop_id = public.get_my_shop_id()
    )
  );

create policy "res_patient_all" on reservations
  for all to authenticated
  using (auth.uid() = patient_id)
  with check (auth.uid() = patient_id);

create policy "res_pharmacist_select" on reservations
  for select to authenticated
  using (shop_id = public.get_my_shop_id());

create policy "res_pharmacist_update" on reservations
  for update to authenticated
  using (shop_id = public.get_my_shop_id())
  with check (shop_id = public.get_my_shop_id());

create policy "res_items_patient_all" on reservation_items
  for all to authenticated
  using (
    exists (
      select 1 from reservations r
      where r.id = reservation_items.reservation_id
        and r.patient_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from reservations r
      where r.id = reservation_items.reservation_id
        and r.patient_id = auth.uid()
    )
  );

create policy "res_items_pharmacist_select" on reservation_items
  for select to authenticated
  using (
    exists (
      select 1 from reservations r
      where r.id = reservation_items.reservation_id
        and r.shop_id = public.get_my_shop_id()
    )
  );

create policy "res_items_pharmacist_update" on reservation_items
  for update to authenticated
  using (
    exists (
      select 1 from reservations r
      where r.id = reservation_items.reservation_id
        and r.shop_id = public.get_my_shop_id()
    )
  );

create policy "aliases_read" on ocr_aliases for select to authenticated using (true);

create policy "reports_patient_all" on patient_reports
  for all to authenticated
  using (auth.uid() = patient_id)
  with check (auth.uid() = patient_id);

create policy "tokens_patient_all" on share_tokens
  for all to authenticated
  using (auth.uid() = patient_id)
  with check (auth.uid() = patient_id);

-- ---------------------------------------------------------------------
-- PART 3: PRIVATE STORAGE BUCKET POLICIES (prescriptions & reports)
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