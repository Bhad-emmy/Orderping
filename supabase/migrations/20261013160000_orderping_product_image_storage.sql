-- OrderPing product image storage.
-- Bucket is public for storefront display; writes are restricted to each business owner.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('orderping-product-images', 'orderping-product-images', true, 5242880, array['image/jpeg','image/png','image/webp','image/avif'])
on conflict (id) do update set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg','image/png','image/webp','image/avif'];

create policy "OrderPing product images are publicly readable"
on storage.objects for select to public
using (bucket_id = 'orderping-product-images');

create policy "Vendors upload images to their own business folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'orderping-product-images'
  and exists (
    select 1 from orderping.businesses b
    where b.id::text = (storage.foldername(name))[1]
      and b.owner_id = (select auth.uid())
  )
);

create policy "Vendors update images in their own business folder"
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

create policy "Vendors delete images in their own business folder"
on storage.objects for delete to authenticated
using (
  bucket_id = 'orderping-product-images'
  and exists (
    select 1 from orderping.businesses b
    where b.id::text = (storage.foldername(name))[1]
      and b.owner_id = (select auth.uid())
  )
);
