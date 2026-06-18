import { NextResponse } from 'next/server'
import { backendFetch } from '@/lib/backendFetch'

export const dynamic = 'force-dynamic'

export async function POST(): Promise<NextResponse> {
  try {
    const resp = await backendFetch('/profile/generate-keywords', { method: 'POST' })
    const json = await resp.json().catch(() => ({}))
    return NextResponse.json(json, { status: resp.status })
  } catch (err) {
    console.error('/api/profile/generate-keywords proxy error:', err)
    return NextResponse.json({ error: 'backend_unreachable' }, { status: 502 })
  }
}
