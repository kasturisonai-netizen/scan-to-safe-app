-- Scan to Safe v2: private per-user inventory
create extension if not exists pgcrypto;

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('medicine', 'general')),
  product_name text not null,
  brand text,
  batch_number text,
  manufacture_date date,
  expiry_date date,
  use_by_date date,
  best_before_date date,
  notes text,
  image_path text,
  raw_ocr_text text,
  ocr_confidence numeric(5,2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_items_user_category_idx
  on public.inventory_items(user_id, category);
create index if not exists inventory_items_user_expiry_idx
  on public.inventory_items(user_id, expiry_date);

alter table public.inventory_items enable row level security;

drop policy if exists "Users can read their own inventory" on public.inventory_items;
create policy "Users can read their own inventory"
  on public.inventory_items for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can add to their own inventory" on public.inventory_items;
create policy "Users can add to their own inventory"
  on public.inventory_items for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own inventory" on public.inventory_items;
create policy "Users can update their own inventory"
  on public.inventory_items for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete their own inventory" on public.inventory_items;
create policy "Users can delete their own inventory"
  on public.inventory_items for delete to authenticated
  using (auth.uid() = user_id);

-- Private image bucket. Upload objects under <auth.uid()>/<filename>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-packaging', 'product-packaging', false, 10485760,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "Users read their own packaging images" on storage.objects;
create policy "Users read their own packaging images"
  on storage.objects for select to authenticated
  using (bucket_id = 'product-packaging' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users upload their own packaging images" on storage.objects;
create policy "Users upload their own packaging images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'product-packaging' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users update their own packaging images" on storage.objects;
create policy "Users update their own packaging images"
  on storage.objects for update to authenticated
  using (bucket_id = 'product-packaging' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'product-packaging' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Users delete their own packaging images" on storage.objects;
create policy "Users delete their own packaging images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'product-packaging' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.set_inventory_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists inventory_items_updated_at on public.inventory_items;
create trigger inventory_items_updated_at
before update on public.inventory_items
for each row execute function public.set_inventory_updated_at();
