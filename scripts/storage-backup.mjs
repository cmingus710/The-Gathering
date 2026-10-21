#!/usr/bin/env node
/**
 * Copies every Storage object to a local folder, or puts such a copy back.
 * Supabase database backups hold only the objects' metadata, never the
 * files, so this is the storage half of a backup (docs/operations-recovery.md).
 *
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SECRET_KEY=… node scripts/storage-backup.mjs backup  <folder>
 *   NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SECRET_KEY=… node scripts/storage-backup.mjs restore <folder> [--yes]
 *
 * Operator use only: the secret key bypasses every access rule, so run this
 * on a trusted computer and keep the folder as private as the database.
 * `backup` writes <folder>/<bucket>/<path> plus manifest.json (size, type,
 * SHA-256). `restore` uploads (overwrites) every file in the copy and never
 * deletes; without --yes it only reports what it would do. It doesn't skip
 * files the bucket lists already: after a database restore the listing comes
 * from restored metadata even when the file itself is gone.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const [mode, folder, flag] = process.argv.slice(2);
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!["backup", "restore"].includes(mode) || !folder || !url || !key) {
  console.error("Usage: NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SECRET_KEY=… node scripts/storage-backup.mjs backup|restore <folder> [--yes]");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const safeJoin = (root, ...parts) => {
  const target = path.resolve(root, ...parts);
  if (!target.startsWith(path.resolve(root) + path.sep)) throw new Error(`Refusing path outside the folder: ${parts.join("/")}`);
  return target;
};

async function listAll(bucket, prefix = "") {
  const files = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`);
    for (const entry of data) {
      const full = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) files.push(...(await listAll(bucket, full)));
      else files.push({ path: full, size: entry.metadata?.size ?? null, type: entry.metadata?.mimetype ?? "application/octet-stream" });
    }
    if (data.length < 1000) return files;
  }
}

if (mode === "backup") {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw new Error(error.message);
  const manifest = { createdAt: new Date().toISOString(), source: new URL(url).host, buckets: {} };
  for (const bucket of buckets) {
    const files = await listAll(bucket.id);
    manifest.buckets[bucket.id] = { public: bucket.public, files: [] };
    for (const file of files) {
      const { data: blob, error: dlError } = await supabase.storage.from(bucket.id).download(file.path);
      if (dlError) throw new Error(`${bucket.id}/${file.path}: ${dlError.message}`);
      const buf = Buffer.from(await blob.arrayBuffer());
      const target = safeJoin(folder, bucket.id, file.path);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, buf);
      manifest.buckets[bucket.id].files.push({ path: file.path, size: buf.length, type: file.type, sha256: sha256(buf) });
    }
    console.log(`${bucket.id}: ${files.length} file(s)`);
  }
  await writeFile(path.join(folder, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`Manifest written to ${path.join(folder, "manifest.json")}`);
} else {
  const manifest = JSON.parse(await readFile(path.join(folder, "manifest.json"), "utf8"));
  const apply = flag === "--yes";
  let uploads = 0;
  for (const [bucket, info] of Object.entries(manifest.buckets)) {
    for (const file of info.files) {
      const buf = await readFile(safeJoin(folder, bucket, file.path));
      if (sha256(buf) !== file.sha256) throw new Error(`Backup copy changed since it was made: ${bucket}/${file.path}`);
      uploads++;
      if (!apply) {
        console.log(`would upload ${bucket}/${file.path}`);
        continue;
      }
      const { error } = await supabase.storage.from(bucket).upload(file.path, buf, { contentType: file.type, upsert: true });
      if (error) throw new Error(`${bucket}/${file.path}: ${error.message}`);
      console.log(`uploaded ${bucket}/${file.path}`);
    }
  }
  console.log(apply ? `Restored ${uploads} file(s).` : `${uploads} file(s) would be uploaded. Re-run with --yes to upload.`);
}
