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
  const isPublicApi = path.startsWith('/api/client/');

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
