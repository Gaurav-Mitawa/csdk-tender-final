import { NextRequest, NextResponse } from 'next/server'
import { backendFetch } from '@/lib/backendFetch'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ tk_id: string; filename: string }> },
): Promise<NextResponse> {
  const { tk_id, filename } = await context.params
  if (
    !/^[A-Za-z0-9_-]{1,64}$/.test(tk_id) ||
    filename.includes('/') ||
    filename.includes('..')
  ) {
    return NextResponse.json({ error: 'invalid path' }, { status: 400 })
  }
  try {
    const resp = await backendFetch(
      `/tenders/${tk_id}/docs/${encodeURIComponent(filename)}`,
    )
    if (!resp.ok) {
      return NextResponse.json(
        { error: 'document not found' },
        { status: resp.status },
      )
    }
    const blob = await resp.blob()
    return new NextResponse(blob, {
      status: 200,
      headers: {
        'content-type':
          resp.headers.get('content-type') ?? 'application/octet-stream',
        'content-disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (err) {
    console.error('src/app/api/tenders/[tk_id]/docs/[filename]/route.ts proxy error:', err)
    return NextResponse.json({ error: 'backend_unreachable' }, { status: 502 })
  }
}
