'use client'

import { cn } from '@/lib/utils'

interface StatusBadgeProps {
  isConnected: boolean
}

export function StatusBadge({ isConnected }: StatusBadgeProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-mono uppercase tracking-[0.2em]',
        isConnected
          ? 'border-emerald-400/30 bg-emerald-400/5 text-emerald-600'
          : 'border-rose-400/30 bg-rose-400/5 text-rose-600'
      )}
    >
      <span className="relative inline-flex h-2 w-2">
        <span
          className={cn(
            'absolute inline-flex h-full w-full rounded-full opacity-60',
            isConnected ? 'animate-ping bg-emerald-400' : 'bg-rose-400'
          )}
        />
        <span
          className={cn(
            'relative inline-flex h-2 w-2 rounded-full',
            isConnected ? 'bg-emerald-400' : 'bg-rose-400'
          )}
        />
      </span>
      {isConnected ? 'Live' : 'Offline'}
    </div>
  )
}
