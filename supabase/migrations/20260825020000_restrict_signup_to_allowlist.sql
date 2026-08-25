create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table private.signup_email_allowlist (
  email text primary key,
  created_at timestamptz not null default now(),
  constraint signup_email_allowlist_normalized_check
    check (email = lower(btrim(email)) and position('@' in email) > 1)
);

alter table private.signup_email_allowlist enable row level security;

create policy "auth_admin_reads_signup_allowlist"
on private.signup_email_allowlist for select
to supabase_auth_admin
using (true);

revoke all on table private.signup_email_allowlist
from public, anon, authenticated;

grant usage on schema private to supabase_auth_admin;
grant select on table private.signup_email_allowlist to supabase_auth_admin;

create function public.hook_restrict_signup_to_allowlist(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  requested_email text := lower(btrim(event->'user'->>'email'));
begin
  if requested_email is not null and exists (
    select 1
    from private.signup_email_allowlist allowlist
    where allowlist.email = requested_email
  ) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Este aplicativo e de uso privado.'
    )
  );
end;
$$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_restrict_signup_to_allowlist(jsonb)
to supabase_auth_admin;

revoke execute on function public.hook_restrict_signup_to_allowlist(jsonb)
from public, anon, authenticated;
