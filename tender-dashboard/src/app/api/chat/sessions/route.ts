import { NextRequest, NextResponse } from 'next/server'
import { backendFetch } from '@/lib/backendFetch'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<NextResponse> {
  try {
    const resp = await backendFetch('/chat/sessions')
    return NextResponse.json(await resp.json().catch(() => ({})), { status: resp.status })
  } catch (err) {
    console.error('/api/chat/sessions GET proxy error:', err)
    return NextResponse.json({ error: 'backend_unreachable' }, { status: 502 })
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.text()
  try {
    const resp = await backendFetch('/chat/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body || '{}',
    })
    return NextResponse.json(await resp.json().catch(() => ({})), { status: resp.status })
  } catch (err) {
    console.error('/api/chat/sessions POST proxy error:', err)
    return NextResponse.json({ error: 'backend_unreachable' }, { status: 502 })
  }
}
