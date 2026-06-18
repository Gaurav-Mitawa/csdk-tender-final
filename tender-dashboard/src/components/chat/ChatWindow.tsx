'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, LoaderCircle, Play, Send, Sparkles, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useInterventions } from '@/hooks/useInterventions'
import { StatusBadge } from './StatusBadge'
import { MessageBubble } from './MessageBubble'

export function ChatWindow() {
  const {
    messages,
    isConnected,
    progress,
    clearProgress,
    addSystemMessage,
    addAgentMessage,
    addUserMessage,
  } = useInterventions()

  const [hasMounted, setHasMounted] = useState(false)
  const [running, setRunning] = useState(false)
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  // Session expired mid-use: the cookie's gone/stale and in-page fetches start
  // 401ing. Bounce to login (preserving where we were) instead of showing a
  // confusing dead chat.
  const handleAuthExpiry = (status: number): boolean => {
    if (status === 401) {
      const next = encodeURIComponent(window.location.pathname)
      window.location.href = `/login?next=${next}`
      return true
    }
    return false
  }

  useEffect(() => {
    setHasMounted(true)
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length, thinking, progress])

  const showSpinner = !hasMounted || (!isConnected && messages.length === 0)
  const isEmpty = hasMounted && isConnected && messages.length === 0

  const triggerRun = async () => {
    setRunning(true)
    addSystemMessage('Starting Tenderkart cycle…', 'info')
    try {
      const res = await fetch('/api/runs/trigger', { method: 'POST' })
      if (handleAuthExpiry(res.status)) return
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        addSystemMessage(
          'Cycle queued. The agent will narrate progress here as each filter completes.',
          'success',
        )
      } else if (res.status === 409) {
        addSystemMessage('A cycle is already running — wait for it to finish.', 'error')
      } else {
        addSystemMessage(
          `Could not start cycle: ${json?.error ?? json?.detail ?? res.statusText}`,
          'error',
        )
      }
    } catch (err) {
      addSystemMessage(`Backend not reachable: ${(err as Error).message}`, 'error')
    } finally {
      setRunning(false)
    }
  }

  const stopRun = async () => {
    clearProgress() // hide the live tracker immediately — don't wait for the backend event
    try {
      const res = await fetch('/api/runs/stop', { method: 'POST' })
      if (handleAuthExpiry(res.status)) return
      const json = await res.json().catch(() => ({}))
      addSystemMessage(json?.message ?? 'Stopping the scan…', 'info')
    } catch (err) {
      addSystemMessage(`Could not stop the scan: ${(err as Error).message}`, 'error')
    }
  }

  const sendChat = async () => {
    const text = input.trim()
    if (!text || thinking) return
    setInput('')
    addUserMessage(text)
    setThinking(true)
    const recent = messages
      .slice(-6)
      .filter((m) => m.role === 'agent' || m.role === 'user')
      .map((m) => ({ role: m.role, content: m.content }))
    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text, history: recent }),
      })
      if (handleAuthExpiry(res.status)) return
      const json = await res.json().catch(() => ({}))
      if (res.ok && json?.reply) {
        addAgentMessage(json.reply)
      } else {
        addSystemMessage(
          `Agent error: ${json?.error ?? json?.detail ?? res.statusText}`,
          'error',
        )
      }
    } catch (err) {
      addSystemMessage(`Agent unreachable: ${(err as Error).message}`, 'error')
    } finally {
      setThinking(false)
    }
  }

  const renderedMessages = useMemo(() => messages, [messages])

  return (
    <div className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-background text-foreground">
      <div aria-hidden className="pointer-events-none absolute inset-0 [background-image:linear-gradient(rgba(0,0,0,0.045)_1px,transparent_1px),linear-gradient(90deg,rgba(0,0,0,0.045)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[420px] w-[820px] -translate-x-1/2 rounded-full bg-amber-500/10 blur-[120px]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 right-0 h-[320px] w-[520px] rounded-full bg-sky-500/10 blur-[120px]" />

      <header className="relative z-10 flex shrink-0 items-center justify-between gap-4 border-b border-border bg-background/80 px-5 py-4 backdrop-blur-md sm:px-8">
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-amber-400/30 bg-gradient-to-br from-amber-500/30 to-amber-700/20 text-amber-600 shadow-[0_0_24px_-6px_rgba(245,158,11,0.5)]">
            <Bot className="h-5 w-5" />
          </div>
          <div className="flex flex-col">
            <h1 className="font-mono text-[11px] uppercase tracking-[0.32em] text-muted-foreground">Tender · Agent · Console</h1>
            <p className="font-serif text-lg italic leading-tight text-foreground">Live agent</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={triggerRun}
            disabled={running}
            className={cn(
              'group flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2',
              'font-mono text-[11px] uppercase tracking-[0.18em] text-amber-700',
              'transition hover:border-amber-400/60 hover:bg-amber-400/20 disabled:opacity-50',
            )}
          >
            {running ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {progress && !progress.done ? 'New scan' : 'Run agent now'}
          </button>
          {progress && !progress.done && (
            <button
              type="button"
              onClick={stopRun}
              className={cn(
                'group flex items-center gap-2 rounded-lg border border-red-400/50 bg-red-400/10 px-3 py-2',
                'font-mono text-[11px] uppercase tracking-[0.18em] text-red-700',
                'transition hover:border-red-400/70 hover:bg-red-400/20',
              )}
            >
              <Square className="h-3.5 w-3.5" /> Stop scan
            </button>
          )}
          <StatusBadge isConnected={isConnected} />
        </div>
      </header>

      <div ref={containerRef} className="relative z-10 flex-1 overflow-y-auto px-4 py-6 sm:px-8 sm:py-8">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          {showSpinner && <ConnectingState />}
          {isEmpty && <EmptyState />}

          {progress && !progress.done && (
            <div className="sticky top-0 z-20 rounded-xl border border-amber-400/40 bg-amber-50/90 p-4 backdrop-blur">
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">{progress.label ?? 'Running…'}</span>
                <span className="font-mono text-amber-700">
                  {progress.total
                    ? `${progress.processed ?? 0}/${progress.total} · ${Math.min(100, Math.round(progress.pct ?? 0))}%`
                    : `${progress.processed ?? 0} processed`}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-amber-200/60">
                <div
                  className={cn(
                    'h-full rounded-full bg-amber-500 transition-all',
                    !progress.total && 'w-1/3 animate-pulse',
                  )}
                  style={progress.total ? { width: `${Math.min(100, Math.round(progress.pct ?? 0))}%` } : undefined}
                />
              </div>
            </div>
          )}

          {renderedMessages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}

          {thinking && (
            <div className="flex items-center gap-2 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
              <LoaderCircle className="h-3 w-3 animate-spin" />
              Agent thinking…
            </div>
          )}

          <div ref={endRef} />
        </div>
      </div>

      <footer className="relative z-10 shrink-0 border-t border-border bg-card px-4 py-3 backdrop-blur-md sm:px-8">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              sendChat()
            }}
            className="flex items-center gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask the agent — top tenders, deadlines, scoring, run a fresh scan…"
              disabled={thinking}
              className={cn(
                'h-11 w-full flex-1 rounded-lg border border-border bg-background px-4 text-sm text-foreground',
                'placeholder:text-muted-foreground outline-none focus:border-amber-400/50',
              )}
            />
            <button
              type="submit"
              disabled={thinking || !input.trim()}
              className={cn(
                'flex h-11 items-center gap-2 rounded-lg bg-amber-500 px-4',
                'font-mono text-[11px] uppercase tracking-[0.2em] text-zinc-950',
                'hover:bg-amber-400 disabled:opacity-50',
              )}
            >
              <Send className="h-4 w-4" />
              Send
            </button>
          </form>
        </div>
      </footer>
    </div>
  )
}

function ConnectingState() {
  return (
    <div className="mx-auto flex flex-col items-center justify-center gap-3 py-16 text-center">
      <LoaderCircle className="h-6 w-6 animate-spin text-amber-600" />
      <div className="font-mono text-[11px] uppercase tracking-[0.28em] text-muted-foreground">Connecting to agent…</div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="mx-auto flex flex-col items-center justify-center gap-4 py-20 text-center">
      <div className="relative">
        <div className="absolute inset-0 animate-ping rounded-full bg-amber-400/15" />
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full border border-amber-400/30 bg-amber-400/5 text-amber-600">
          <Sparkles className="h-6 w-6" />
        </div>
      </div>
      <div className="space-y-1">
        <p className="font-serif text-2xl italic text-foreground">Say hi to your agent</p>
        <p className="max-w-md font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          Hit “Run agent now” to fire a Tenderkart cycle, or ask the agent — it answers from the latest run state.
        </p>
      </div>
    </div>
  )
}
