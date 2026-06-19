'use client'

import { format, parseISO } from 'date-fns'
import {
  Bot,
  User,
  CheckCircle2,
  XCircle,
  Info,
  Download,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ChatMessage } from '@/lib/types'
import { CopyButton } from './CopyButton'

interface MessageBubbleProps {
  message: ChatMessage
}

function formatTime(iso: string): string {
  try {
    return format(parseISO(iso), 'h:mm a')
  } catch {
    return ''
  }
}

const TYPE_ACCENT: Record<ChatMessage['type'], string> = {
  text: 'border-border bg-muted',
  success: 'border-emerald-400/40 bg-emerald-400/5',
  error: 'border-rose-400/40 bg-rose-400/5',
  info: 'border-border bg-transparent',
}

function TypeIcon({ type }: { type: ChatMessage['type'] }) {
  const cls = 'h-3.5 w-3.5'
  switch (type) {
    case 'success':
      return <CheckCircle2 className={cn(cls, 'text-emerald-600')} />
    case 'error':
      return <XCircle className={cn(cls, 'text-rose-600')} />
    case 'info':
      return <Info className={cn(cls, 'text-muted-foreground')} />
    default:
      return null
  }
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const time = formatTime(message.timestamp)

  if (message.role === 'system') {
    return (
      <div className="flex items-center justify-center gap-2 py-2 text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
        <span className="h-px w-8 bg-border" />
        <TypeIcon type={message.type} />
        <span className="italic">{message.content}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">{time}</span>
        <span className="h-px w-8 bg-border" />
      </div>
    )
  }

  const isAgent = message.role === 'agent'

  return (
    <div
      className={cn(
        'flex w-full gap-3',
        isAgent ? 'justify-start' : 'justify-end'
      )}
    >
      {isAgent && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-amber-600">
          <Bot className="h-4 w-4" />
        </div>
      )}

      <div
        className={cn(
          'group relative rounded-2xl border px-4 py-3 text-sm leading-relaxed shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]',
          // Report messages carry a long grouped list — give them more room to breathe.
          isAgent && message.combined_url ? 'max-w-[94%]' : 'max-w-[78%]',
          isAgent
            ? cn('rounded-tl-sm text-foreground', TYPE_ACCENT[message.type])
            : 'rounded-tr-sm border-amber-400/30 bg-gradient-to-br from-amber-500/20 via-amber-500/10 to-orange-500/10 text-amber-900'
        )}
      >
        <CopyButton
          text={message.content}
          className={cn('absolute top-2', isAgent ? 'right-2' : 'left-2')}
        />
        {isAgent && (
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.22em] text-muted-foreground">
            <TypeIcon type={message.type} />
            <span>Agent</span>
          </div>
        )}

        <p
          className={cn(
            'whitespace-pre-wrap break-words',
            !isAgent && 'font-mono tracking-wider text-base'
          )}
        >
          {message.content}
        </p>

        {isAgent && message.combined_url ? (
          <div className="mt-3">
            <a
              href={message.combined_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg border border-violet-400/40 bg-violet-400/10 px-3 py-1.5 text-xs font-mono uppercase tracking-[0.18em] text-violet-700 transition hover:bg-violet-400/20"
            >
              <Download className="h-3.5 w-3.5" />
              Tender Intelligence Report
            </a>
          </div>
        ) : isAgent && (message.executive_url || message.eligibility_url) ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {message.executive_url && (
              <a
                href={message.executive_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-xs font-mono uppercase tracking-[0.18em] text-amber-700 transition hover:bg-amber-400/20"
              >
                <Download className="h-3.5 w-3.5" />
                Executive summary
              </a>
            )}
            {message.eligibility_url && (
              <a
                href={message.eligibility_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-sky-400/40 bg-sky-400/10 px-3 py-1.5 text-xs font-mono uppercase tracking-[0.18em] text-sky-700 transition hover:bg-sky-400/20"
              >
                <Download className="h-3.5 w-3.5" />
                Eligibility report
              </a>
            )}
          </div>
        ) : null}

        <div
          className={cn(
            'mt-1.5 text-[10px] font-mono uppercase tracking-[0.18em]',
            isAgent ? 'text-muted-foreground' : 'text-amber-700/70'
          )}
        >
          {time}
        </div>
      </div>

      {!isAgent && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-amber-400/30 bg-amber-500/10 text-amber-600">
          <User className="h-4 w-4" />
        </div>
      )}
    </div>
  )
}
