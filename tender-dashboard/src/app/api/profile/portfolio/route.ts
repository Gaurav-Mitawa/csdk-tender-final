import { NextRequest, NextResponse } from 'next/server'
import { backendFetch } from '@/lib/backendFetch'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  try {
    const resp = await backendFetch('/profile/portfolio')
    const json = await resp.json().catch(() => ({}))
    return NextResponse.json(json, { status: resp.status })
  } catch (err) {
    console.error('/api/profile/portfolio GET proxy error:', err)
    return NextResponse.json({ error: 'backend_unreachable' }, { status: 502 })
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const body = await req.text()
  try {
    const resp = await backendFetch('/profile/portfolio', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body,
    })
    const json = await resp.json().catch(() => ({}))
    return NextResponse.json(json, { status: resp.status })
  } catch (err) {
    console.error('/api/profile/portfolio PUT proxy error:', err)
    return NextResponse.json({ error: 'backend_unreachable' }, { status: 502 })
  }
}
