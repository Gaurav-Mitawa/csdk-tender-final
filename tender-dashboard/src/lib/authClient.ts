'use client'

/**
 * Client-side auth helpers shared by the chat provider and chat window.
 *
 * On a 401 we first try to mint a fresh access token from the refresh-token
 * cookie. Only if that fails do we log out + bounce to /login — and we ALWAYS
 * clear the cookie first, otherwise the middleware sees the (stale) cookie,
 * bounces /login → /, and the page refreshes in a loop (the "every 3s" bug).
 */

let refreshing: Promise<boolean> | null = null

/** Try to refresh the session. De-dupes concurrent 401s into one round-trip. */
export async function attemptRefresh(): Promise<boolean> {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const r = await fetch('/api/auth/refresh', { method: 'POST' })
        return r.ok
      } catch {
        return false
      }
    })().finally(() => {
      // Release the lock on the next tick so a later 401 can refresh again.
      refreshing = null
    })
  }
  return refreshing
}

/** Clear the cookies, then hard-redirect to /login (no bounce loop). */
export async function logoutAndRedirect(): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    await fetch('/api/auth/logout', { method: 'POST' })
  } catch {
    /* ignore — navigate regardless */
  }
  const next = encodeURIComponent(window.location.pathname)
  window.location.href = `/login?next=${next}`
}
