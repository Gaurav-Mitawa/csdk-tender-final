'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import type { ChatMessage } from '@/lib/types'

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

const STORAGE_KEY = 'tender-agent.chat.messages.v2'
// localStorage is only a UX cache — the durable record of cycle progress +
// report links lives in the `cycle_events` table and is re-fetched on mount
// (see backfill below). Bumped from 200 so longer sessions keep more context.
const MAX_PERSIST = 500
// How many recent cycle_events to pull on mount / reconnect to recover any
// realtime INSERTs missed while the socket was down (e.g. the completion row
// that carries the report download link).
const BACKFILL_LIMIT = 50

interface CycleEventRow {
  id: string
  created_at?: string
  level: 'info' | 'success' | 'warn' | 'error'
  message: string
  meta: {
    is_chat_reply?: boolean
    combined_url?: string
    combined_name?: string
    executive_url?: string
    executive_name?: string
    eligibility_url?: string
    eligibility_name?: string
    progress?: { pct?: number; label?: string; processed?: number; total?: number; done?: boolean }
    report?: boolean
  } | null
}

export type RunProgress = { pct?: number; label?: string; processed?: number; total?: number; done?: boolean }

function rowToMessage(row: CycleEventRow): ChatMessage {
  const isChatReply = !!row.meta?.is_chat_reply
  const type: ChatMessage['type'] = isChatReply
    ? 'text'
    : row.level === 'success'
      ? 'success'
      : row.level === 'error' || row.level === 'warn'
        ? 'error'
        : 'info'
  return {
    id: `cycle-${row.id}`,
    role: isChatReply ? 'agent' : 'system',
    content: row.message,
    type,
    timestamp: row.created_at ?? new Date().toISOString(),
    combined_url: row.meta?.combined_url,
    combined_name: row.meta?.combined_name,
    executive_url: row.meta?.executive_url,
    executive_name: row.meta?.executive_name,
    eligibility_url: row.meta?.eligibility_url,
    eligibility_name: row.meta?.eligibility_name,
  }
}

function loadPersisted(): ChatMessage[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as ChatMessage[]) : []
  } catch {
    return []
  }
}

function savePersisted(messages: ChatMessage[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(messages.slice(-MAX_PERSIST)),
    )
  } catch (err) {
    // Quota exceeded / private mode. Durable history is in cycle_events, so
    // this is non-fatal, but log it so a wedged cache isn't fully silent.
    console.warn('chat history could not be persisted to localStorage', err)
  }
}

export function useInterventions() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [progress, setProgress] = useState<RunProgress | null>(null)

  // Merge cycle_events rows into state, skipping any whose id already exists.
  // Progress rows (meta.progress) drive the progress bar, NOT the message feed.
  const mergeCycleRows = useCallback((rows: CycleEventRow[]) => {
    if (!rows.length) return
    const prog = rows.filter((r) => r.meta?.progress)
    if (prog.length) setProgress(prog[prog.length - 1].meta!.progress!)
    // Keep only conversation + the report link + errors in the feed. All run
    // narration (scanning/processing/cycle-complete) lives in the progress bar only.
    const feedRows = rows.filter(
      (r) => r.meta?.is_chat_reply || r.meta?.combined_url || r.meta?.report || r.level === 'error',
    )
    if (!feedRows.length) return
    setMessages((prev) => {
      const existing = new Set(prev.map((m) => m.id))
      const additions = feedRows
        .map(rowToMessage)
        .filter((m) => !existing.has(m.id))
      return additions.length ? [...prev, ...additions] : prev
    })
  }, [])

  // Pull the most recent cycle_events so a missed realtime INSERT (socket drop,
  // page reload after a cycle) still surfaces — critically, the completion row
  // with the report download button. Anon SELECT on cycle_events is allowed.
  const backfill = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('cycle_events')
        .select('id, created_at, level, message, meta')
        .order('created_at', { ascending: false })
        .limit(BACKFILL_LIMIT)
      if (error) {
        console.warn('cycle_events backfill failed', error)
        return
      }
      const chronological = (data as CycleEventRow[]).slice().reverse()
      mergeCycleRows(chronological)
    } catch (err) {
      console.warn('cycle_events backfill threw', err)
    }
  }, [mergeCycleRows])

  useEffect(() => {
    const cached = loadPersisted()
    if (cached.length) {
      setMessages((prev) => (prev.length ? prev : cached))
    }
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (hydrated) savePersisted(messages)
  }, [messages, hydrated])

  // After hydration, backfill once from the DB so the latest run + report
  // button always render even if the realtime event was missed. The fetch is
  // async (setMessages runs in a later promise tick), which is the allowed
  // pattern; the lint rule can't see through the useCallback boundary.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (hydrated) void backfill()
  }, [hydrated, backfill])

  const addSystemMessage = useCallback(
    (content: string, type: ChatMessage['type'] = 'info') => {
      setMessages((prev) => [
        ...prev,
        {
          id: makeId('system'),
          role: 'system',
          content,
          type,
          timestamp: new Date().toISOString(),
        },
      ])
    },
    [],
  )

  const addAgentMessage = useCallback((content: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: makeId('agent'),
        role: 'agent',
        content,
        type: 'text',
        timestamp: new Date().toISOString(),
      },
    ])
  }, [])

  const addUserMessage = useCallback((content: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: makeId('user'),
        role: 'user',
        content,
        type: 'text',
        timestamp: new Date().toISOString(),
      },
    ])
  }, [])

  // Subscribe to backend cycle events so the chat narrates progress live.
  // On (re)subscribe — including after a dropped socket reconnects — run a
  // backfill to catch any events emitted while we were offline.
  const wasSubscribed = useRef(false)
  useEffect(() => {
    const channel = supabase
      .channel('cycle-events')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'cycle_events' },
        (payload) => mergeCycleRows([payload.new as CycleEventRow]),
      )
      .subscribe((status) => {
        const subscribed = status === 'SUBSCRIBED'
        setIsConnected(subscribed)
        if (subscribed && wasSubscribed.current) {
          // Reconnect after a prior subscribe — backfill the gap.
          void backfill()
        }
        if (subscribed) wasSubscribed.current = true
      })
    return () => {
      supabase.removeChannel(channel)
    }
  }, [mergeCycleRows, backfill])

  const clearProgress = useCallback(() => setProgress(null), [])

  return {
    messages,
    isConnected,
    progress,
    clearProgress,
    addSystemMessage,
    addAgentMessage,
    addUserMessage,
  }
}
