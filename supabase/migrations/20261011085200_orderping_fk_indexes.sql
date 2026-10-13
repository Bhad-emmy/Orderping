-- Add covering indexes for OrderPing foreign keys flagged by database advisors.
create index if not exists appointments_catalog_item_id_idx
  on orderping.appointments(catalog_item_id);
create index if not exists order_items_catalog_item_id_idx
  on orderping.order_items(catalog_item_id);
