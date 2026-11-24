-- Show hub (My account → Promoter): each show's preview image and colors, so the hub looks like the show.
-- Falls back to the show's share image/poster and the crew's brand colors when these are empty.
alter table public.events
  add column if not exists hub_image text,
  add column if not exists hub_colors jsonb;
update public.events set hub_image = 'https://subduction.art/assets/toftu/hero-sm.webp',
  hub_colors = '{"main":"#FF5A1F","accent":"#B5A1C8","deep":"#3B1760"}'::jsonb
  where slug = 'underground' and hub_image is null;
