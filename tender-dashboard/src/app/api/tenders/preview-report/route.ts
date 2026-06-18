import { NextRequest, NextResponse } from 'next/server'
import { backendFetch } from '@/lib/backendFetch'

export const dynamic = 'force-dynamic'

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

type PreviewBody = {
  tenderkart_ids?: unknown
  count?: unknown
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: PreviewBody
  try {
    body = (await req.json()) as PreviewBody
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }

  const payload: { tenderkart_ids?: string[]; count?: number } = {}

  if (body.tenderkart_ids !== undefined) {
    if (!Array.isArray(body.tenderkart_ids)) {
      return NextResponse.json(
        { error: 'tenderkart_ids must be an array' },
        { status: 400 },
      )
    }
    for (const t of body.tenderkart_ids) {
      if (typeof t !== 'string' || !ID_RE.test(t)) {
        return NextResponse.json(
          { error: `invalid tenderkart_id: ${String(t)}` },
          { status: 400 },
        )
      }
    }
    payload.tenderkart_ids = body.tenderkart_ids as string[]
  }

  if (body.count !== undefined) {
    const n = Number(body.count)
    if (!Number.isInteger(n) || n < 1 || n > 5) {
      return NextResponse.json(
        { error: 'count must be an integer 1-5' },
        { status: 400 },
      )
    }
    payload.count = n
  }

  try {
    const resp = await backendFetch('/tenders/preview-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const text = await resp.text()
    return new NextResponse(text, {
      status: resp.status,
      headers: {
        'content-type':
          resp.headers.get('content-type') ?? 'application/json',
      },
    })
  } catch (err) {
    console.error('src/app/api/tenders/preview-report/route.ts proxy error:', err)
    return NextResponse.json({ error: 'backend_unreachable' }, { status: 502 })
  }
}
