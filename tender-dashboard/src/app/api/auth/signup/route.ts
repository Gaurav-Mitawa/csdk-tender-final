import { NextRequest, NextResponse } from 'next/server'
import { ACCESS_COOKIE, BACKEND } from '@/lib/backendFetch'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.text()
  try {
    const resp = await fetch(`${BACKEND}/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      cache: 'no-store',
    })
    const json = await resp.json().catch(() => ({}))
    const res = NextResponse.json(json, { status: resp.status })
    if (resp.ok && json?.access_token && typeof json.expires_in === 'number') {
      res.cookies.set(ACCESS_COOKIE, json.access_token, {
        httpOnly: true,
        // 'strict' to match the login route — this is the same auth cookie and
        // 'lax' needlessly weakened its CSRF posture vs login.
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: json.expires_in,
      })
    }
    return res
  } catch (err) {
    console.error('src/app/api/auth/signup/route.ts proxy error:', err)
    return NextResponse.json({ error: 'backend_unreachable' }, { status: 502 })
  }
}
