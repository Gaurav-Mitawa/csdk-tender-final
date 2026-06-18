import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_PATHS = ['/login', '/signup']
const PUBLIC_API_PREFIXES = ['/api/auth/']
const ACCESS_COOKIE = 'access_token'

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  const token = req.cookies.get(ACCESS_COOKIE)?.value

  const isPublic =
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p))

  if (!token && !isPublic) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname + search)
    return NextResponse.redirect(url)
  }

  if (token && (pathname === '/login' || pathname === '/signup')) {
    const url = req.nextUrl.clone()
    url.pathname = '/'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  // Run on everything except static assets + favicon. The handler itself
  // whitelists /login, /signup, /api/auth/*.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
