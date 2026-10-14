-- Allow appointment requests without a predefined service or fixed price.
alter table orderping.appointments alter column catalog_item_id drop not null;
alter table orderping.appointments alter column total_amount_minor drop not null;
