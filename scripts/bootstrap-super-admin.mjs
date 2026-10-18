#!/usr/bin/env node
/**
 * One-time appointment of the first super administrator.
 *
 *   SUPABASE_SECRET_KEY=… NEXT_PUBLIC_SUPABASE_URL=… node scripts/bootstrap-super-admin.mjs person@example.org
 *
 * The person must already have registered and verified their email. The
 * database function refuses to run a second time, so this cannot be used to
 * mint additional super administrators (do that from the admin area).
 */
import { createClient } from "@supabase/supabase-js";

const email = process.argv[2];
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!email || !url || !key) {
  console.error("Usage: NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SECRET_KEY=… node scripts/bootstrap-super-admin.mjs <email>");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await supabase.rpc("bootstrap_super_admin", { p_email: email });
if (error) {
  console.error(`Not appointed: ${error.message}`);
  process.exit(1);
}
console.log(`Appointed ${email} (profile ${data}) as the initial super administrator.`);
