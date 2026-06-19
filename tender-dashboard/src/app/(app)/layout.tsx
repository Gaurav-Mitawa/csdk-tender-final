import type { Metadata } from 'next'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppSidebar } from '@/components/app-shell/AppSidebar'
import { ChatProvider } from '@/components/chat/ChatProvider'

export const metadata: Metadata = {
  title: 'Tender Agent',
}

export default function AppGroupLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <TooltipProvider delay={120}>
      <SidebarProvider defaultOpen>
        {/* ChatProvider wraps BOTH the sidebar (session list) and the page (chat window)
            so they share one source of truth for chat sessions. */}
        <ChatProvider>
          <AppSidebar />
          <SidebarInset className="bg-background">
            <SidebarTrigger className="absolute left-3 top-3 z-30 text-muted-foreground hover:text-foreground md:hidden" />
            <div className="h-[100dvh] w-full overflow-hidden">{children}</div>
          </SidebarInset>
        </ChatProvider>
      </SidebarProvider>
    </TooltipProvider>
  )
}
