-- Scan to Safe initial relational model. Apply in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  preferred_language text not null default 'en' check (preferred_language in ('en','hi','mr','bn')),
  created_at timestamptz not null default now()
);

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (household_id,user_id)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid references public.households(id) on delete set null,
  name text not null,
  brand text,
  category text not null default 'Other',
  quantity_label text,
  image_path text,
  purchase_date date,
  purchase_price numeric(12,2),
  store_name text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_batches (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  batch_number text,
  manufacturing_date date,
  date_type text not null default 'unknown'
    check (date_type in ('expiry','best_before','use_by','none','unknown')),
  relevant_date date,
  quantity numeric(12,3),
  unit text,
  date_verified boolean not null default false,
  ocr_raw_text text,
  created_at timestamptz not null default now()
);

create table if not exists public.scan_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  image_path text,
  raw_ocr_text text,
  extracted_data jsonb not null default '{}'::jsonb,
  review_status text not null default 'pending' check (review_status in ('pending','confirmed','rejected')),
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  batch_id uuid references public.product_batches(id) on delete cascade,
  channel text not null default 'in_app' check (channel in ('in_app','push','email')),
  title text not null,
  body text not null,
  scheduled_for timestamptz,
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.products enable row level security;
alter table public.product_batches enable row level security;
alter table public.scan_records enable row level security;
alter table public.notifications enable row level security;

-- Initial owner-scoped policies. Shared household policies must be added and tested
-- before family sharing is enabled in production.
create policy "profile owner select" on public.profiles for select using (auth.uid() = id);
create policy "profile owner update" on public.profiles for update using (auth.uid() = id);
create policy "products owner access" on public.products for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "scan owner access" on public.scan_records for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "notifications owner access" on public.notifications for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "batch owner access" on public.product_batches for all
using (exists(select 1 from public.products p where p.id = product_id and p.owner_id = auth.uid()))
with check (exists(select 1 from public.products p where p.id = product_id and p.owner_id = auth.uid()));
