import { NextRequest, NextResponse } from 'next/server'
import { backendFetch } from '@/lib/backendFetch'

export const dynamic = 'force-dynamic'

// Same shape as the preview-report route — validate IDs rather than forwarding
// arbitrary caller input straight to the backend with our bearer token.
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const url = new URL(req.url)
    const filterIds = url.searchParams.get('filter_ids')
    const params = new URLSearchParams({ triggered_by: 'manual' })
    if (filterIds) {
      const ids = filterIds.split(',').map((s) => s.trim()).filter(Boolean)
      for (const id of ids) {
        if (!ID_RE.test(id)) {
          return NextResponse.json(
            { error: `invalid filter_id: ${id}` },
            { status: 400 },
          )
        }
      }
      if (ids.length) params.set('filter_ids', ids.join(','))
    }
    // Forward the chat session that triggered the run so the backend can post the
    // report back into it (validate it looks like a UUID/id, not arbitrary input).
    const sessionId = url.searchParams.get('session_id')
    if (sessionId && ID_RE.test(sessionId)) params.set('session_id', sessionId)
    const resp = await backendFetch(`/runs/trigger?${params}`, { method: 'POST' })
    const json = await resp.json().catch(() => ({}))
    return NextResponse.json(json, { status: resp.status })
  } catch (err) {
    console.error('src/app/api/runs/trigger/route.ts proxy error:', err)
    return NextResponse.json({ error: 'backend_unreachable' }, { status: 502 })
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    const resp = await backendFetch('/runs/status')
    const json = await resp.json().catch(() => ({}))
    return NextResponse.json(json, { status: resp.status })
  } catch (err) {
    console.error('src/app/api/runs/trigger/route.ts proxy error:', err)
    return NextResponse.json({ error: 'backend_unreachable' }, { status: 502 })
  }
}
