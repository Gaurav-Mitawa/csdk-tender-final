import { NextRequest, NextResponse } from 'next/server'
import { backendFetch } from '@/lib/backendFetch'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ filename: string }> },
): Promise<NextResponse> {
  const { filename } = await context.params
  if (filename.includes('/') || filename.includes('..')) {
    return NextResponse.json({ error: 'invalid filename' }, { status: 400 })
  }
  try {
    const resp = await backendFetch(`/reports/${encodeURIComponent(filename)}`)
    if (!resp.ok) {
      return NextResponse.json(
        { error: 'report not found' },
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
    console.error('src/app/api/reports/[filename]/route.ts proxy error:', err)
    return NextResponse.json({ error: 'backend_unreachable' }, { status: 502 })
  }
}
