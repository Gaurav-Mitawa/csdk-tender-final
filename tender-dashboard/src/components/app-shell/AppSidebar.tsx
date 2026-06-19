'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { MessageSquare, Plus, Search, Settings, Sparkles, Trash2 } from 'lucide-react'
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

export function AppSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { sessions, activeId, newChat, selectSession, deleteSession } = useChat()
  const [query, setQuery] = useState('')

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
                        'h-9 rounded-lg border border-transparent pr-8 text-sm text-foreground',
                        'hover:border-border hover:bg-muted',
                        'data-[active=true]:border-amber-400/40 data-[active=true]:bg-amber-400/10 data-[active=true]:text-amber-700',
                      )}
                    >
                      <MessageSquare className="h-4 w-4 shrink-0" />
                      <span className="truncate">{s.title}</span>
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
