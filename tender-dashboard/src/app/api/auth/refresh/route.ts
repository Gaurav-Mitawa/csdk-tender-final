import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { ACCESS_COOKIE, BACKEND, REFRESH_COOKIE } from '@/lib/backendFetch'

export const dynamic = 'force-dynamic'

// Exchange the long-lived refresh-token cookie for a fresh access token and
// re-set both cookies. Called by the client when a request 401s, so a session
// survives the short access-token lifetime (and long agent runs).
export async function POST(): Promise<NextResponse> {
  try {
    const jar = await cookies()
    const refreshToken = jar.get(REFRESH_COOKIE)?.value
    if (!refreshToken) {
      return NextResponse.json({ error: 'no_refresh_token' }, { status: 401 })
    }
    const resp = await fetch(`${BACKEND}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
      cache: 'no-store',
    })
    const json = await resp.json().catch(() => ({}))
    const res = NextResponse.json(json, { status: resp.status })
    if (resp.ok && json?.access_token && typeof json.expires_in === 'number') {
      res.cookies.set(ACCESS_COOKIE, json.access_token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: json.expires_in,
      })
      if (json?.refresh_token) {
        res.cookies.set(REFRESH_COOKIE, json.refresh_token, {
          httpOnly: true,
          sameSite: 'strict',
          secure: process.env.NODE_ENV === 'production',
          path: '/',
          maxAge: 60 * 60 * 24 * 30,
        })
      }
    }
    return res
  } catch (err) {
    console.error('/api/auth/refresh proxy error:', err)
    return NextResponse.json({ error: 'backend_unreachable' }, { status: 502 })
  }
}
