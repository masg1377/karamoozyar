import { type NextRequest, NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login'];
const ADMIN_PATHS = ['/admin'];

export function middleware(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;

  // Splash screen — always allow root exactly
  if (pathname === '/') return NextResponse.next();

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Check auth cookie (we store a flag after login)
  const isLoggedIn = req.cookies.get('auth_flag')?.value === 'true';
  const userRole = req.cookies.get('user_role')?.value;

  if (!isLoggedIn) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // RBAC: admin paths require ADMIN role
  if (ADMIN_PATHS.some((p) => pathname.startsWith(p)) && userRole !== 'ADMIN') {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  // USER paths require USER role (prevent admin from accessing user-only pages)
  if (pathname.startsWith('/dashboard') || pathname.startsWith('/chat') || pathname.startsWith('/newsletter')) {
    if (userRole === 'ADMIN') {
      return NextResponse.redirect(new URL('/admin', req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  // هر مسیری که شامل یک نقطه باشد (فایل‌های static مثل sw.js، manifest.webmanifest،
  // آیکون‌ها و …) و نیز _next و api از middleware مستثنا می‌شوند. در غیر این صورت
  // درخواست این فایل‌ها در حالت ناوارد به /login ریدایرکت می‌شد و نصب PWA می‌شکست.
  matcher: ['/((?!_next/static|_next/image|api|.*\\.).*)'],
};
