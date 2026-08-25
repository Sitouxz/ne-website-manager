import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isLoginPage = path === '/login';
  const isAcceptInvitePage = path === '/accept-invite';
  const isPublicApi = authenticatesItself(path);

  // `/accept-invite` must stay reachable without an existing session: a
  // user who just clicked an invite email link arrives here via Supabase
  // Auth's implicit-grant redirect (`#access_token=...&type=invite` —
  // confirmed by `inviteUserByEmail`'s own docs: PKCE is not supported for
  // invites, since the inviting and accepting browsers are usually
  // different). That fragment is never sent to the server at all (URL
  // fragments aren't part of the HTTP request), so on the very first
  // request for this page there is no session cookie yet for this
  // middleware to see — only the client-side Supabase JS (which runs
  // after this middleware, once the page loads) can read the fragment and
  // establish the session. Bouncing to `/login` here, before that has a
  // chance to happen, would break the invite flow entirely.
  if (!user && !isLoginPage && !isAcceptInvitePage && !isPublicApi) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  if (user && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};

/**
 * Endpoints that carry their own credential instead of a session cookie, and
 * so must never be bounced to `/login`:
 *
 *   - `/api/client/**` — the public content API (per-client API key, or
 *     anonymous read of published content).
 *   - `/api/cron/**` — Vercel Cron, authorised by `CRON_SECRET`.
 *   - `/api/mcp` — the MCP endpoint, authorised by an `api_keys` bearer
 *     token.
 *
 * **`/api/cron/**` was missing here, and that was a live bug.** Vercel Cron
 * sends an ordinary HTTP request with no Supabase session, so every
 * invocation matched the `!user` branch below and was answered with a 307 to
 * `/login` — the route's own `CRON_SECRET` check never ran. Scheduled posts
 * did not publish and analytics did not roll up, and because a redirect is a
 * successful response, nothing reported an error. Verified against the dev
 * server: 307 before this list included it, 401 (the route's own check)
 * after.
 *
 * Exported so the list is a tested contract rather than a condition three
 * layers into a request handler.
 */
export function authenticatesItself(path: string): boolean {
  return path.startsWith('/api/client/') || path.startsWith('/api/cron/') || path === '/api/mcp';
}
