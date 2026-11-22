import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env, hasSupabaseEnv } from '../config/env'

let supabaseClient: SupabaseClient | null = null

export function getSupabaseBrowserClient() {
  if (!hasSupabaseEnv()) {
    throw new Error(
      'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy web-app/.env.example to web-app/.env.local first.',
    )
  }

  if (!supabaseClient) {
    supabaseClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  }

  return supabaseClient
}

export async function getAuthorizationHeader(): Promise<{ Authorization: string }> {
  const { data } = await getSupabaseBrowserClient().auth.getSession()
  const accessToken = data.session?.access_token
  if (!accessToken) {
    throw new Error('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.')
  }

  return { Authorization: `Bearer ${accessToken}` }
}
