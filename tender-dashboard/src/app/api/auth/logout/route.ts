import { NextResponse } from 'next/server'
import { ACCESS_COOKIE, REFRESH_COOKIE } from '@/lib/backendFetch'

export const dynamic = 'force-dynamic'

export async function POST(): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true })
  for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
    res.cookies.set(name, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 0,
    })
  }
  return res
}
