import { NextResponse } from 'next/server'
import { ACCESS_COOKIE } from '@/lib/backendFetch'

export const dynamic = 'force-dynamic'

export async function POST(): Promise<NextResponse> {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(ACCESS_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
  return res
}
