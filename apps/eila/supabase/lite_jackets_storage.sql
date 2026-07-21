-- Scan and Sort: private per-user storage for sorted deal-jacket PDFs (the
-- "blue folder" on the deal card — held 90 days, then deleted by
-- /api/cron/jacket-cleanup). Applied to the MissionOS Lite project 2026-07-10
-- as migration jackets_storage_bucket; kept here so the infra is reproducible.
-- Bucket is PRIVATE (signed URLs only); each user can touch ONLY files under
-- their own auth.uid() folder. PDFs only, 25MB cap.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('jackets', 'jackets', false, 26214400, array['application/pdf'])
on conflict (id) do nothing;

create policy "jackets owner select" on storage.objects
  for select to authenticated
  using (bucket_id = 'jackets' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "jackets owner insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'jackets' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "jackets owner update" on storage.objects
  for update to authenticated
  using (bucket_id = 'jackets' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'jackets' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "jackets owner delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'jackets' and (storage.foldername(name))[1] = auth.uid()::text);
