'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Eye, EyeOff, Sparkles } from 'lucide-react'

export function SignupForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const resp = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const json = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        setError(json?.detail || json?.error || 'Signup failed')
        return
      }
      router.replace('/')
      router.refresh()
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-7 shadow-[0_0_60px_-20px_rgba(245,158,11,0.25)] backdrop-blur-md">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-400/30 bg-gradient-to-br from-amber-500/30 to-amber-700/20 text-amber-600">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="flex flex-col">
            <span className="font-mono text-[10px] uppercase tracking-[0.32em] text-muted-foreground">
              CSDirekt · Tender
            </span>
            <span className="font-serif text-lg italic text-foreground">Request access</span>
          </div>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Email
            </span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10 rounded-lg border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-amber-400/50"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              Password (≥ 8 chars)
            </span>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-card px-3 pr-10 text-sm text-foreground outline-none focus:border-amber-400/50"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </label>
          {error && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-600">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="mt-2 h-10 rounded-lg border border-amber-400/40 bg-amber-400/10 font-mono text-xs uppercase tracking-[0.22em] text-amber-700 transition hover:bg-amber-400/20 disabled:opacity-50"
          >
            {loading ? 'Creating…' : 'Create account'}
          </button>
        </form>

        <p className="mt-5 text-center font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Have an account?{' '}
          <Link href="/login" className="text-amber-600 hover:text-amber-700">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  )
}
