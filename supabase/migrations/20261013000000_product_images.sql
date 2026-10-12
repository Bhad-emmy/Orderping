alter table orderping.catalog_items
  add column if not exists image_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'orderping-product-images',
  'orderping-product-images',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'OrderPing vendors upload product images'
  ) then
    create policy "OrderPing vendors upload product images"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'orderping-product-images'
        and exists (
          select 1 from orderping.businesses b
          where b.id::text = (storage.foldername(name))[1]
            and b.owner_id = (select auth.uid())
        )
      );
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'OrderPing vendors update product images'
  ) then
    create policy "OrderPing vendors update product images"
      on storage.objects for update to authenticated
      using (
        bucket_id = 'orderping-product-images'
        and exists (
          select 1 from orderping.businesses b
          where b.id::text = (storage.foldername(name))[1]
            and b.owner_id = (select auth.uid())
        )
      )
      with check (
        bucket_id = 'orderping-product-images'
        and exists (
          select 1 from orderping.businesses b
          where b.id::text = (storage.foldername(name))[1]
            and b.owner_id = (select auth.uid())
        )
      );
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'OrderPing vendors delete product images'
  ) then
    create policy "OrderPing vendors delete product images"
      on storage.objects for delete to authenticated
      using (
        bucket_id = 'orderping-product-images'
        and exists (
          select 1 from orderping.businesses b
          where b.id::text = (storage.foldername(name))[1]
            and b.owner_id = (select auth.uid())
        )
      );
  end if;
end $$;
