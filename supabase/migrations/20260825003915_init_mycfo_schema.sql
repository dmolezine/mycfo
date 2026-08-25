create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '' check (char_length(name) <= 80),
  cycle_start_day smallint not null default 1 check (cycle_start_day between 1 and 28),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  type text not null check (type in ('income', 'expense')),
  icon text not null default 'uil-tag-alt' check (char_length(icon) <= 60),
  created_at timestamptz not null default now(),
  constraint categories_user_type_name_key unique (user_id, type, name),
  constraint categories_id_user_key unique (id, user_id)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null,
  type text not null check (type in ('income', 'expense')),
  description text not null check (char_length(btrim(description)) between 1 and 80),
  amount numeric(14, 2) not null check (amount > 0),
  occurred_on date not null,
  status text not null default 'paid' check (status in ('paid', 'pending')),
  source_transaction_id uuid,
  external_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_category_owner_fkey
    foreign key (category_id, user_id) references public.categories(id, user_id),
  constraint transactions_user_external_key_key unique (user_id, external_key)
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null,
  cycle_start date not null,
  amount numeric(14, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint budgets_category_owner_fkey
    foreign key (category_id, user_id) references public.categories(id, user_id),
  constraint budgets_user_cycle_category_key unique (user_id, cycle_start, category_id)
);

create index transactions_user_date_idx on public.transactions (user_id, occurred_on desc);
create index transactions_user_status_date_idx on public.transactions (user_id, status, occurred_on);
create index budgets_user_cycle_idx on public.budgets (user_id, cycle_start);
create index categories_user_type_idx on public.categories (user_id, type);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger transactions_set_updated_at
before update on public.transactions
for each row execute function public.set_updated_at();

create trigger budgets_set_updated_at
before update on public.budgets
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;

create policy "profiles_select_own"
on public.profiles for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "profiles_insert_own"
on public.profiles for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "profiles_update_own"
on public.profiles for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "profiles_delete_own"
on public.profiles for delete
to authenticated
using ((select auth.uid()) = user_id);

create policy "categories_select_own"
on public.categories for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "categories_insert_own"
on public.categories for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "categories_update_own"
on public.categories for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "categories_delete_own"
on public.categories for delete
to authenticated
using ((select auth.uid()) = user_id);

create policy "transactions_select_own"
on public.transactions for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "transactions_insert_own"
on public.transactions for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "transactions_update_own"
on public.transactions for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "transactions_delete_own"
on public.transactions for delete
to authenticated
using ((select auth.uid()) = user_id);

create policy "budgets_select_own"
on public.budgets for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "budgets_insert_own"
on public.budgets for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "budgets_update_own"
on public.budgets for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "budgets_delete_own"
on public.budgets for delete
to authenticated
using ((select auth.uid()) = user_id);

revoke all on public.profiles, public.categories, public.transactions, public.budgets from anon;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.categories, public.transactions, public.budgets to authenticated;

revoke all on function public.set_updated_at() from public, anon, authenticated;
