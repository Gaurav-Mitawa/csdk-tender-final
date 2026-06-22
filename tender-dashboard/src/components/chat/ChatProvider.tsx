'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { supabase } from '@/lib/supabase/client'
import { attemptRefresh, logoutAndRedirect } from '@/lib/authClient'
import type { ChatMessage } from '@/lib/types'

// Account-based chat: sessions + messages live in Supabase (scoped by the logged-in user
// via the backend), so the same account sees its chats from any device. No localStorage.

export type RunProgress = {
  pct?: number
  label?: string
  processed?: number
  total?: number
  done?: boolean
}

export interface SessionMeta {
  id: string
  title: string
  updatedAt: string
}

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
    eligibility_url?: string
    progress?: RunProgress
    report?: boolean
  } | null
}

interface DbMessage {
  id: string
  role: ChatMessage['role']
  content: string
  type?: ChatMessage['type']
  meta?: Record<string, string> | null
  cycle_id?: string | null
  created_at?: string
}

function dbToMessage(r: DbMessage): ChatMessage {
  return {
    id: `db-${r.id}`,
    role: r.role,
    content: r.content,
    type: r.type ?? 'text',
    timestamp: r.created_at ?? new Date().toISOString(),
    combined_url: r.meta?.combined_url,
    combined_name: r.meta?.combined_name,
    executive_url: r.meta?.executive_url,
    eligibility_url: r.meta?.eligibility_url,
  }
}

function cycleToMessage(row: CycleEventRow): ChatMessage {
  const isReply = !!row.meta?.is_chat_reply
  const type: ChatMessage['type'] = isReply
    ? 'text'
    : row.level === 'success'
      ? 'success'
      : row.level === 'error' || row.level === 'warn'
        ? 'error'
        : 'info'
  return {
    id: `cycle-${row.id}`,
    role: isReply ? 'agent' : 'system',
    content: row.message,
    type,
    timestamp: row.created_at ?? new Date().toISOString(),
    combined_url: row.meta?.combined_url,
    combined_name: row.meta?.combined_name,
    executive_url: row.meta?.executive_url,
    eligibility_url: row.meta?.eligibility_url,
  }
}

function localId(p: string): string {
  return `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

// fetch JSON. On 401: try to refresh the session once and retry; only if that
// fails do we log out + bounce to /login (after clearing the cookie, so we don't
// loop). On any other non-OK (e.g. 503 while a scan saturates the API) we throw
// WITHOUT logging out, so callers keep their current state instead of wiping it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function j(url: string, init?: RequestInit): Promise<any> {
  let r = await fetch(url, init)
  if (r.status === 401 && (await attemptRefresh())) {
    r = await fetch(url, init) // retry once with the freshly-minted token
  }
  if (r.status === 401) {
    await logoutAndRedirect()
    throw new Error('unauthorized')
  }
  if (!r.ok) {
    throw new Error(`request_failed_${r.status}`)
  }
  return r.json().catch(() => ({}))
}

interface ChatCtx {
  sessions: SessionMeta[]
  activeId: string | null
  messages: ChatMessage[]
  isConnected: boolean
  progress: RunProgress | null
  loading: boolean
  newChat: () => void
  selectSession: (id: string) => void
  deleteSession: (id: string) => void
  renameSession: (id: string, title: string) => void
  addUserMessage: (content: string) => void
  addAgentMessage: (content: string) => void
  addSystemMessage: (content: string, type?: ChatMessage['type']) => void
  clearProgress: () => void
}

const Ctx = createContext<ChatCtx | null>(null)

export function useChat(): ChatCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useChat must be used inside <ChatProvider>')
  return v
}

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const [sessions, setSessions] = useState<SessionMeta[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [progress, setProgress] = useState<RunProgress | null>(null)
  const [loading, setLoading] = useState(true)

  const activeIdRef = useRef<string | null>(null)
  activeIdRef.current = activeId
  // cycle_events already shown in the current messages view (avoid double-add live).
  const cycleSeen = useRef<Set<string>>(new Set())

  const loadMessages = useCallback(async (id: string) => {
    cycleSeen.current = new Set()
    try {
      const data = await j(`/api/chat/sessions/${id}`)
      const rows: DbMessage[] = data?.messages || []
      rows.forEach((m) => {
        if (m.cycle_id) cycleSeen.current.add(m.cycle_id)
      })
      setMessages(rows.map(dbToMessage))
    } catch {
      setMessages([])
    }
  }, [])

  // ── init: load this user's sessions (create one if none) ──
  const inited = useRef(false)
  useEffect(() => {
    if (inited.current) return // guard StrictMode double-invoke (would double-create a session)
    inited.current = true
    let alive = true
    ;(async () => {
      try {
        const data = await j('/api/chat/sessions')
        let list: SessionMeta[] = (data?.sessions || []).map((s: { id: string; title: string; updated_at: string }) => ({
          id: s.id,
          title: s.title || 'New chat',
          updatedAt: s.updated_at,
        }))
        if (!list.length) {
          const created = await j('/api/chat/sessions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          })
          if (created?.id) list = [{ id: created.id, title: created.title || 'New chat', updatedAt: created.updated_at }]
        }
        if (!alive) return
        setSessions(list)
        const first = list[0]?.id ?? null
        setActiveId(first)
        if (first) await loadMessages(first)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [loadMessages])

  // ── rehydrate the live progress bar on mount ──
  // After a refresh mid-run, `progress` resets to null and only the NEXT cycle_event
  // (minutes away) would bring it back. Pull the current run's latest progress event
  // up front so the tracker reappears immediately instead of after ~4-5 minutes.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch('/api/runs/trigger') // GET → /runs/status
        if (!res.ok) return
        const run = await res.json().catch(() => ({}))
        if (!alive || !run?.id || run.status !== 'running') return
        const { data } = await supabase
          .from('cycle_events')
          .select('meta')
          .eq('run_id', run.id)
          .order('created_at', { ascending: false })
          .limit(50)
        const last = (data || []).find(
          (r: { meta?: { progress?: RunProgress } }) => r?.meta?.progress,
        )
        const p = last?.meta?.progress
        if (alive && p && !p.done) setProgress(p)
      } catch {
        /* best-effort — the realtime feed will catch up on the next event */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const touchSession = useCallback((id: string, titleFromUser?: string) => {
    setSessions((prev) => {
      const i = prev.findIndex((s) => s.id === id)
      if (i < 0) return prev
      const s = prev[i]
      const title = titleFromUser && (s.title === 'New chat' || !s.title)
        ? titleFromUser.replace(/\s+/g, ' ').trim().slice(0, 52) || s.title
        : s.title
      const updated = { ...s, title, updatedAt: new Date().toISOString() }
      return [updated, ...prev.filter((x) => x.id !== id)]
    })
  }, [])

  const persist = useCallback(
    (role: ChatMessage['role'], content: string, type: ChatMessage['type'], meta?: Record<string, string>, cycleId?: string) => {
      const id = activeIdRef.current
      if (!id) return
      const payload: Record<string, unknown> = { role, content, type }
      if (meta) payload.meta = meta
      if (cycleId) payload.cycle_id = cycleId
      void fetch(`/api/chat/sessions/${id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {})
      touchSession(id, role === 'user' ? content : undefined)
    },
    [touchSession],
  )

  const addLocal = useCallback(
    (role: ChatMessage['role'], content: string, type: ChatMessage['type'] = 'text') => {
      setMessages((prev) => [...prev, { id: localId(role), role, content, type, timestamp: new Date().toISOString() }])
      persist(role, content, type)
    },
    [persist],
  )

  const addUserMessage = useCallback((c: string) => addLocal('user', c, 'text'), [addLocal])
  const addAgentMessage = useCallback((c: string) => addLocal('agent', c, 'text'), [addLocal])
  const addSystemMessage = useCallback(
    (c: string, type: ChatMessage['type'] = 'info') => addLocal('system', c, type),
    [addLocal],
  )

  // ── live run narration (cycle_events) ──
  const mergeCycle = useCallback(
    (rows: CycleEventRow[]) => {
      if (!rows.length) return
      const prog = rows.filter((r) => r.meta?.progress)
      if (prog.length) setProgress(prog[prog.length - 1].meta!.progress!)
      if (!activeIdRef.current) return
      const feed = rows.filter(
        (r) => r.meta?.is_chat_reply || r.meta?.combined_url || r.meta?.report || r.level === 'error',
      )
      const fresh = feed.filter((r) => !cycleSeen.current.has(r.id))
      if (!fresh.length) return
      fresh.forEach((r) => {
        cycleSeen.current.add(r.id)
        const m = cycleToMessage(r)
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
        // The end-of-run REPORT is persisted to chat by the BACKEND now (so it survives a
        // closed tab / long run). Only DISPLAY it live here — don't double-write it, which
        // used to create duplicates. Other events (errors, chat replies) we still persist.
        if (r.meta?.report || r.meta?.combined_url) return
        const meta: Record<string, string> = {}
        if (m.combined_url) meta.combined_url = m.combined_url
        if (m.combined_name) meta.combined_name = m.combined_name
        if (m.executive_url) meta.executive_url = m.executive_url
        if (m.eligibility_url) meta.eligibility_url = m.eligibility_url
        persist(m.role, m.content, m.type, Object.keys(meta).length ? meta : undefined, r.id)
      })
    },
    [persist],
  )

  useEffect(() => {
    const channel = supabase
      .channel('cycle-events')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'cycle_events' },
        (payload) => mergeCycle([payload.new as CycleEventRow]),
      )
      .subscribe((status) => setIsConnected(status === 'SUBSCRIBED'))
    return () => {
      supabase.removeChannel(channel)
    }
  }, [mergeCycle])

  // ── session operations ──
  const newChat = useCallback(async () => {
    setProgress(null)
    try {
      const created = await j('/api/chat/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      if (created?.id) {
        setSessions((prev) => [{ id: created.id, title: created.title || 'New chat', updatedAt: created.updated_at }, ...prev])
        setActiveId(created.id)
        cycleSeen.current = new Set()
        setMessages([])
      }
    } catch {
      /* ignore */
    }
  }, [])

  const selectSession = useCallback(
    (id: string) => {
      if (id === activeIdRef.current) return
      setActiveId(id)
      setProgress(null)
      setMessages([])
      void loadMessages(id)
    },
    [loadMessages],
  )

  const deleteSession = useCallback(
    async (id: string) => {
      void fetch(`/api/chat/sessions/${id}`, { method: 'DELETE' }).catch(() => {})
      const remaining = sessions.filter((s) => s.id !== id)
      if (remaining.length) {
        setSessions(remaining)
        if (activeIdRef.current === id) selectSession(remaining[0].id)
      } else {
        setSessions([])
        await newChat()
      }
    },
    [sessions, selectSession, newChat],
  )

  const renameSession = useCallback((id: string, title: string) => {
    const t = title.trim()
    if (!t) return
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title: t } : s)))
    void fetch(`/api/chat/sessions/${id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: t }),
    }).catch(() => {})
  }, [])

  const clearProgress = useCallback(() => setProgress(null), [])

  const value = useMemo<ChatCtx>(
    () => ({
      sessions,
      activeId,
      messages,
      isConnected,
      progress,
      loading,
      newChat,
      selectSession,
      deleteSession,
      renameSession,
      addUserMessage,
      addAgentMessage,
      addSystemMessage,
      clearProgress,
    }),
    [sessions, activeId, messages, isConnected, progress, loading, newChat, selectSession, deleteSession, renameSession, addUserMessage, addAgentMessage, addSystemMessage, clearProgress],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
