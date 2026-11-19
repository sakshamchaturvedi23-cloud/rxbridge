import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Cookie-based Supabase client for authenticated user requests in Server Components,
 * Server Actions, and Route Handlers.
 *
 * Automatically manages session tokens in HTTP cookies and respects Row-Level Security (RLS)
 * for the authenticated patient or pharmacist.
 */
export async function createClient() {
  const cookieStore = await cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing Supabase environment variables: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be configured."
    );
  }

  return createServerClient<Database>(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be safely ignored when middleware handles session refresh.
          }
        },
      },
    }
  );
}

/**
 * Admin Supabase client using SUPABASE_SERVICE_ROLE_KEY.
 *
 * STRICT SECURITY RULES (per SOURCE_OF_TRUTH.md):
 * - Bypasses Row Level Security (RLS).
 * - Strictly for verified server API routes (e.g. cross-user flows, doctor QR token validation,
 *   pharmacist verification, and ocr_aliases writes).
 * - Never expose SUPABASE_SERVICE_ROLE_KEY to the browser or prefix it with NEXT_PUBLIC_.
 */
export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error("createAdminClient must strictly be called in server environments.");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing Supabase admin environment variables: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured."
    );
  }

  return createSupabaseClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
