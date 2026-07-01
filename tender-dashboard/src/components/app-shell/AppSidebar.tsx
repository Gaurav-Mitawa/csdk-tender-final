'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, FileSearch, MessageSquare, Plus, Search, Settings, Sparkles, Trash2 } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { LogoutButton } from '@/components/auth/LogoutButton'
import { useChat } from '@/components/chat/ChatProvider'

interface TenderResult {
  id: string
  title: string
  reference_number?: string | null
  issuing_authority?: string | null
  verdict?: string | null
  closing_date?: string | null
  report_url?: string | null
}

// Format a session's start time like "1 Jul 2026, 12:01 AM" (best-effort).
const fmtWhen = (iso?: string) => {
  try {
    return new Date(iso!).toLocaleString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  } catch {
    return ''
  }
}

export function AppSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { sessions, activeId, newChat, selectSession, deleteSession } = useChat()
  const [query, setQuery] = useState('')
  const [tenderQuery, setTenderQuery] = useState('')
  const [tenderResults, setTenderResults] = useState<TenderResult[]>([])
  const [tenderSearching, setTenderSearching] = useState(false)
  const [tenderSearched, setTenderSearched] = useState(false)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const sorted = [...sessions].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    if (!q) return sorted
    return sorted.filter((s) => s.title.toLowerCase().includes(q))
  }, [sessions, query])

  const goChat = (id: string) => {
    selectSession(id)
    if (pathname !== '/chat') router.push('/chat')
  }

  const startNew = () => {
    newChat()
    if (pathname !== '/chat') router.push('/chat')
  }

  // Debounced tender search → /api/tenders/search. Cancels stale requests via
  // an AbortController; errors fall back to empty results silently.
  useEffect(() => {
    const q = tenderQuery.trim()
    if (q.length < 2) {
      setTenderResults([])
      setTenderSearching(false)
      setTenderSearched(false)
      return
    }
    const ctrl = new AbortController()
    setTenderSearching(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/tenders/search?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        })
        const data = await res.json().catch(() => ({}))
        setTenderResults(Array.isArray(data?.results) ? data.results : [])
        setTenderSearched(true)
      } catch {
        if (!ctrl.signal.aborted) {
          setTenderResults([])
          setTenderSearched(true)
        }
      } finally {
        if (!ctrl.signal.aborted) setTenderSearching(false)
      }
    }, 300)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [tenderQuery])

  const openTender = (r: TenderResult) => {
    if (r.report_url) window.open(r.report_url, '_blank', 'noopener,noreferrer')
  }

  return (
    <Sidebar collapsible="icon" className="border-r border-border bg-card backdrop-blur-md">
      <SidebarHeader className="border-b border-border px-3 py-4">
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-400/30 bg-gradient-to-br from-amber-500/30 to-amber-700/20 text-amber-600 shadow-[0_0_24px_-6px_rgba(245,158,11,0.5)]">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate font-mono text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
              Tender · Agent
            </span>
            <span
              style={{ fontFamily: "'Times New Roman', Georgia, serif" }}
              className="truncate text-base font-normal not-italic leading-tight tracking-tight text-foreground"
            >
              Workspace
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="py-3">
        {/* New chat */}
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={startNew}
                  className={cn(
                    'h-10 rounded-lg border border-amber-400/40 bg-amber-400/10 font-mono text-xs uppercase tracking-[0.18em] text-amber-700',
                    'hover:border-amber-400/60 hover:bg-amber-400/20',
                  )}
                >
                  <Plus className="h-4 w-4" />
                  <span>New chat</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Search */}
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupContent>
            <div className="relative px-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <SidebarInput
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chats…"
                className="pl-8"
              />
            </div>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Tender search → open report PDF */}
        <SidebarGroup className="group-data-[collapsible=icon]:hidden">
          <SidebarGroupLabel className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
            Search tenders
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="relative px-1">
              <FileSearch className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <SidebarInput
                value={tenderQuery}
                onChange={(e) => setTenderQuery(e.target.value)}
                placeholder="Search tenders by name…"
                className="pl-8"
              />
            </div>
            {(tenderSearching || tenderResults.length > 0 || tenderSearched) && (
              <div className="mt-1 px-1">
                {tenderSearching ? (
                  <p className="px-2 py-2 text-xs italic text-muted-foreground">Searching…</p>
                ) : tenderResults.length === 0 ? (
                  tenderSearched && (
                    <p className="px-2 py-2 text-xs italic text-muted-foreground">No tenders match.</p>
                  )
                ) : (
                  <ul className="flex flex-col gap-1">
                    {tenderResults.map((r) => {
                      const hasReport = !!r.report_url
                      const meta = [r.issuing_authority, r.verdict].filter(Boolean).join(' · ')
                      return (
                        <li key={r.id}>
                          <button
                            type="button"
                            onClick={() => openTender(r)}
                            disabled={!hasReport}
                            title={hasReport ? 'Open report PDF' : 'No report generated yet'}
                            className={cn(
                              'flex w-full flex-col items-start gap-0.5 rounded-lg border border-transparent px-2 py-1.5 text-left',
                              hasReport
                                ? 'text-foreground hover:border-amber-400/40 hover:bg-amber-400/10'
                                : 'cursor-not-allowed opacity-60',
                            )}
                          >
                            <span className="flex w-full items-center gap-1.5">
                              <span className="min-w-0 flex-1 truncate text-sm">{r.title}</span>
                              {hasReport && (
                                <ExternalLink className="h-3 w-3 shrink-0 text-amber-600" />
                              )}
                            </span>
                            {meta && (
                              <span className="w-full truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                                {meta}
                              </span>
                            )}
                            {!hasReport && (
                              <span className="text-[10px] italic text-muted-foreground">
                                no report yet
                              </span>
                            )}
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )}
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Chat history */}
        <SidebarGroup>
          <SidebarGroupLabel className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground group-data-[collapsible=icon]:hidden">
            Chats
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visible.length === 0 ? (
                <p className="px-3 py-2 text-xs italic text-muted-foreground group-data-[collapsible=icon]:hidden">
                  {query ? 'No chats match.' : 'No chats yet — start one above.'}
                </p>
              ) : (
                visible.map((s) => (
                  <SidebarMenuItem key={s.id}>
                    <SidebarMenuButton
                      onClick={() => goChat(s.id)}
                      isActive={s.id === activeId && pathname === '/chat'}
                      className={cn(
                        'h-auto min-h-9 items-start rounded-lg border border-transparent py-1.5 pr-8 text-sm text-foreground',
                        'hover:border-border hover:bg-muted',
                        'data-[active=true]:border-amber-400/40 data-[active=true]:bg-amber-400/10 data-[active=true]:text-amber-700',
                      )}
                    >
                      <MessageSquare className="mt-0.5 h-4 w-4 shrink-0" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{s.title}</span>
                        {fmtWhen(s.createdAt) && (
                          <span className="truncate font-mono text-[10px] text-muted-foreground">
                            {fmtWhen(s.createdAt)}
                          </span>
                        )}
                      </span>
                    </SidebarMenuButton>
                    <SidebarMenuAction
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        if (window.confirm('Delete this chat?')) deleteSession(s.id)
                      }}
                      showOnHover
                      aria-label="Delete chat"
                      className="text-muted-foreground hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </SidebarMenuAction>
                  </SidebarMenuItem>
                ))
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="flex flex-col gap-1 border-t border-border px-3 py-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              render={
                <Link href="/profile">
                  <Settings className="h-4 w-4" />
                  <span>Settings</span>
                </Link>
              }
              isActive={pathname?.startsWith('/profile')}
              tooltip="Settings"
              className={cn(
                'h-10 rounded-lg border border-transparent font-mono text-xs uppercase tracking-[0.18em] text-foreground',
                'hover:border-border hover:bg-muted',
                'data-[active=true]:border-amber-400/40 data-[active=true]:bg-amber-400/10 data-[active=true]:text-amber-700',
              )}
            />
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarSeparator />
        <LogoutButton />
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground group-data-[collapsible=icon]:hidden">
          v0.1 · Cycle every 2 days
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
