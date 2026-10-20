-- Multipart upload id when the browser sends parts straight to the object store (Vercel + R2).
alter table uploads add column storage_upload_id text;
