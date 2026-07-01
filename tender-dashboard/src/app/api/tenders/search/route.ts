import { NextRequest, NextResponse } from 'next/server'
import { backendFetch } from '@/lib/backendFetch'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest): Promise<NextResponse> {
  const q = (new URL(req.url).searchParams.get('q') ?? '').trim()
  if (!q) {
    return NextResponse.json({ results: [] }, { status: 200 })
  }
  try {
    const resp = await backendFetch('/tenders/search?q=' + encodeURIComponent(q))
    return NextResponse.json(await resp.json().catch(() => ({})), {
      status: resp.status,
    })
  } catch (err) {
    console.error('src/app/api/tenders/search/route.ts proxy error:', err)
    return NextResponse.json({ error: 'backend_unreachable' }, { status: 502 })
  }
}
