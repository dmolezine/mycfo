revoke all privileges on table
  public.profiles,
  public.categories,
  public.transactions,
  public.budgets
from anon, authenticated;

grant select, insert, update, delete on table
  public.profiles,
  public.categories,
  public.transactions,
  public.budgets
to authenticated;

create index transactions_category_owner_idx
  on public.transactions (category_id, user_id);

create index budgets_category_owner_idx
  on public.budgets (category_id, user_id);
