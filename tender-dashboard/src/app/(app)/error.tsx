'use client' // Error boundaries must be Client Components

import { useEffect } from 'react'
import { RotateCcw } from 'lucide-react'

export default function AppError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  useEffect(() => {
    console.error('app error boundary caught:', error)
  }, [error])

  return (
    <div className="flex h-[100dvh] w-full flex-col items-center justify-center gap-5 bg-background px-6 text-center text-foreground">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-400/30 bg-rose-400/10 text-rose-600">
        <RotateCcw className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <p className="font-serif text-2xl italic">Something broke</p>
        <p className="max-w-md font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          The console hit an unexpected error. Your data is safe — retry to
          reload this view.
        </p>
      </div>
      <button
        type="button"
        onClick={() => unstable_retry()}
        className="flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-amber-700 transition hover:bg-amber-400/20"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Try again
      </button>
    </div>
  )
}
