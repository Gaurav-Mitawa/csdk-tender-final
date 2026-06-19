'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { LogOut } from 'lucide-react'

export function LogoutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  async function onClick() {
    setPending(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      // Chat sessions are persisted to localStorage (see lib/chat/sessions.ts).
      // Auth cookie clears server-side, but stale chat from a prior user would
      // otherwise survive logout. Wipe every chat cache key so the next user
      // lands on a clean conversation.
      if (typeof window !== 'undefined') {
        for (const k of [
          'tender-agent.chat.sessions.v1',
          'tender-agent.chat.mergedCycleIds.v1',
          'tender-agent.chat.messages.v2',
          'tender-agent.chat.messages.v1',
        ]) {
          try {
            window.localStorage.removeItem(k)
          } catch {
            /* ignore quota/privacy errors */
          }
        }
      }
      router.replace('/login')
      router.refresh()
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="flex h-9 w-full items-center gap-2 rounded-lg border border-border px-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground transition hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-600 disabled:opacity-50"
      title="Sign out"
    >
      <LogOut className="h-4 w-4 shrink-0" />
      <span className="group-data-[collapsible=icon]:hidden">
        {pending ? 'Signing out…' : 'Sign out'}
      </span>
    </button>
  )
}
