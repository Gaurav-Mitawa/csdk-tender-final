import { NextRequest, NextResponse } from 'next/server'
import { backendFetch } from '@/lib/backendFetch'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.text()
  try {
    const resp = await backendFetch('/agent/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    const json = await resp.json().catch(() => ({}))
    return NextResponse.json(json, { status: resp.status })
  } catch (err) {
    console.error('src/app/api/agent/chat/route.ts proxy error:', err)
    return NextResponse.json({ error: 'backend_unreachable' }, { status: 502 })
  }
}
