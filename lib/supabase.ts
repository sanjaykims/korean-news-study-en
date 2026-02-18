import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Anon client — for frontend reads (uses public env vars)
let anonClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (anonClient) return anonClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return null;

  anonClient = createClient(url, anonKey);
  return anonClient;
}

// Admin client — for server-side writes in API routes (uses service_role key)
let adminClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (adminClient) return adminClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) return null;

  adminClient = createClient(url, serviceKey);
  return adminClient;
}
