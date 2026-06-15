# Dystoria — cover images (Supabase Storage) setup

Cover images are **compressed in the browser** (≈40–120 KB WebP) and uploaded to a Supabase
Storage bucket called **`media`**. Only the image's URL is stored in the story document, so the
database and live-sync stay small. The image files live in object storage, not in the doc.

## One-time setup

In the Supabase dashboard → **SQL Editor**, paste and run this. It creates a public `media`
bucket and policies so anyone can *view* covers, but a signed-in writer can only *upload* into
their own folder (`<their-user-id>/…`).

```sql
-- 1) public bucket for media (covers, and later in-story images)
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = true;

-- 2) policies on storage.objects for this bucket
create policy "media public read"
  on storage.objects for select
  to public
  using ( bucket_id = 'media' );

create policy "media owner insert"
  on storage.objects for insert
  to authenticated
  with check ( bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text );

create policy "media owner update"
  on storage.objects for update
  to authenticated
  using ( bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text );

create policy "media owner delete"
  on storage.objects for delete
  to authenticated
  using ( bucket_id = 'media' and (storage.foldername(name))[1] = auth.uid()::text );
```

(If a policy name already exists from a re-run, drop it first or rename — Postgres errors on
duplicate policy names, which is harmless.)

## Use

- Open the **Library** → hover a story card → **+ Cover** (or **Change cover**) → pick an image.
- You must be **signed in** (covers upload to your Supabase account). The × on a cover removes it.
- Covers sync to your other devices and to anyone the story is shared with (just the URL travels).

## Notes / future

- Upload path is `media/<user-id>/<story-id>.webp`, so each story has one cover that overwrites.
- Free Supabase Storage is **1 GB** (~10,000 covers at this size) and **5 GB/month bandwidth**.
  If covers ever get heavy on bandwidth, the same client code can point at **Cloudflare R2**
  (10 GB, no egress fees) with a small Worker upload endpoint — no change to the doc model.
- In-story image insert can reuse `uploadCover`/`compressImage` against the same bucket.
