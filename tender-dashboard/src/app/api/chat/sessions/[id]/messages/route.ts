import { NextRequest, NextResponse } from 'next/server'
import { backendFetch } from '@/lib/backendFetch'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params
  const body = await req.text()
  try {
    const resp = await backendFetch(`/chat/sessions/${encodeURIComponent(id)}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    return NextResponse.json(await resp.json().catch(() => ({})), { status: resp.status })
  } catch (err) {
    console.error('/api/chat/sessions/[id]/messages POST proxy error:', err)
    return NextResponse.json({ error: 'backend_unreachable' }, { status: 502 })
  }
}
