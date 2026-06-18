import type { Metadata } from 'next'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppSidebar } from '@/components/app-shell/AppSidebar'

export const metadata: Metadata = {
  title: 'Tender Agent',
}

export default function AppGroupLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <TooltipProvider delay={120}>
      <SidebarProvider defaultOpen>
        <AppSidebar />
        <SidebarInset className="bg-background">
          <SidebarTrigger className="absolute left-3 top-3 z-30 text-muted-foreground hover:text-foreground md:hidden" />
          <div className="h-[100dvh] w-full overflow-hidden">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
