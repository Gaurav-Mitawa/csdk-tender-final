'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Bot, Settings, Sparkles } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { LogoutButton } from '@/components/auth/LogoutButton'

interface NavItem {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  description: string
}

const NAV_ITEMS: NavItem[] = [
  {
    label: 'Chat',
    href: '/chat',
    icon: Bot,
    description: 'Tender intelligence chat — drive Tenderkart cycles',
  },
  {
    label: 'Settings',
    href: '/profile',
    icon: Settings,
    description: 'Company profile & bid rules',
  },
]

export function AppSidebar() {
  const pathname = usePathname()

  return (
    <Sidebar
      collapsible="icon"
      className="border-r border-border bg-card backdrop-blur-md"
    >
      <SidebarHeader className="border-b border-border px-3 py-4">
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-400/30 bg-gradient-to-br from-amber-500/30 to-amber-700/20 text-amber-600 shadow-[0_0_24px_-6px_rgba(245,158,11,0.5)]">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate font-mono text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
              Tender · Agent
            </span>
            <span className="truncate font-serif text-base italic leading-tight text-foreground">
              Console
            </span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="py-3">
        <SidebarGroup>
          <SidebarGroupLabel className="font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground group-data-[collapsible=icon]:hidden">
            Workspace
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const active =
                  pathname === item.href || pathname?.startsWith(item.href + '/')
                const Icon = item.icon
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      render={
                        <Link href={item.href}>
                          <Icon className="h-4 w-4" />
                          <span>{item.label}</span>
                        </Link>
                      }
                      isActive={active}
                      tooltip={item.label}
                      className={cn(
                        'h-10 rounded-lg border border-transparent font-mono text-xs uppercase tracking-[0.18em] text-foreground',
                        'hover:border-border hover:bg-muted hover:text-foreground',
                        'data-[active=true]:border-amber-400/40 data-[active=true]:bg-amber-400/10 data-[active=true]:text-amber-700'
                      )}
                    />
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="flex flex-col gap-2 border-t border-border px-3 py-3">
        <LogoutButton />
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground group-data-[collapsible=icon]:hidden">
          v0.1 · Cycle every 2 days
        </div>
      </SidebarFooter>
    </Sidebar>
  )
}
