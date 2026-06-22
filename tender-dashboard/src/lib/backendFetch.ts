/**
 * Centralized backend proxy helper.
 *
 * Reads the `access_token` cookie set by /api/auth/login and forwards it to
 * the FastAPI backend as `Authorization: Bearer <token>`. Backend is stateless
 * — it never touches cookies, only the bearer header.
 */

import { cookies } from 'next/headers'

export const ACCESS_COOKIE = 'access_token'
export const REFRESH_COOKIE = 'refresh_token'

export const BACKEND =
  process.env.BACKEND_API_URL ?? 'http://localhost:9000'

/** Build outgoing headers with auth + optional content-type, merged with caller's. */
export async function authHeaders(
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  const jar = await cookies()
  const token = jar.get(ACCESS_COOKIE)?.value
  const h: Record<string, string> = { ...extra }
  if (token) h['authorization'] = `Bearer ${token}`
  return h
}

/** Thin wrapper around fetch that injects Authorization header. */
export async function backendFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const extra: Record<string, string> = {}
  if (init.headers) {
    for (const [k, v] of Object.entries(
      init.headers as Record<string, string>,
    )) {
      const key = k.toLowerCase()
      // Never let a caller override auth — Authorization is set ONLY from the
      // session cookie below. Drop any incoming authorization/cookie header.
      if (key === 'authorization' || key === 'cookie') continue
      extra[key] = v
    }
  }
  const headers = await authHeaders(extra)
  return fetch(`${BACKEND}${path}`, { ...init, headers, cache: 'no-store' })
}
