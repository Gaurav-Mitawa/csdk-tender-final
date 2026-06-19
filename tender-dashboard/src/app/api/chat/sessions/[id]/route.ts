import { NextRequest, NextResponse } from 'next/server'
import { backendFetch } from '@/lib/backendFetch'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params
  try {
    const resp = await backendFetch(`/chat/sessions/${encodeURIComponent(id)}`)
    return NextResponse.json(await resp.json().catch(() => ({})), { status: resp.status })
  } catch (err) {
    console.error('/api/chat/sessions/[id] GET proxy error:', err)
    return NextResponse.json({ error: 'backend_unreachable' }, { status: 502 })
  }
}

export async function PUT(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params
  const body = await req.text()
  try {
    const resp = await backendFetch(`/chat/sessions/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body,
    })
    return NextResponse.json(await resp.json().catch(() => ({})), { status: resp.status })
  } catch (err) {
    console.error('/api/chat/sessions/[id] PUT proxy error:', err)
    return NextResponse.json({ error: 'backend_unreachable' }, { status: 502 })
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { id } = await ctx.params
  try {
    const resp = await backendFetch(`/chat/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' })
    return NextResponse.json(await resp.json().catch(() => ({})), { status: resp.status })
  } catch (err) {
    console.error('/api/chat/sessions/[id] DELETE proxy error:', err)
    return NextResponse.json({ error: 'backend_unreachable' }, { status: 502 })
  }
}
