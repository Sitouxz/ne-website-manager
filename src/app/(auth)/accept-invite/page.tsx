'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Eye, EyeOff, KeyRound, AlertCircle, Loader2, CheckCircle } from 'lucide-react';

/**
 * Accept-invite page — Task 6.1. Reached via the link in an
 * `auth.admin.inviteUserByEmail` email (see
 * `src/app/api/team/invite/route.ts`), which sets
 * `redirectTo: '<origin>/accept-invite?token=<token>'`.
 *
 * ## PKCE vs. implicit flow — investigated, not assumed
 *
 * This app's browser Supabase client (`src/lib/supabase/client.ts`, via
 * `createBrowserClient` from `@supabase/ssr`) defaults to `flowType:
 * 'pkce'` — `@supabase/ssr` overrides the underlying `@supabase/auth-js`
 * default of `'implicit'`. That would normally mean email links arrive as
 * `?code=...` requiring an explicit `exchangeCodeForSession` call.
 *
 * BUT: `auth.admin.inviteUserByEmail`'s own JSDoc (in
 * `@supabase/auth-js`'s `GoTrueAdminApi`) states outright: "Note that PKCE
 * is not supported when using `inviteUserByEmail`. This is because the
 * browser initiating the invite is often different from the browser
 * accepting the invite which makes it difficult to provide the security
 * guarantees required of the PKCE flow." Tracing `GoTrueClient`'s own
 * PKCE-callback detector (`_isPKCECallback`) confirms why: it requires a
 * `code_verifier` already present in this browser's local storage, which
 * only exists if this same browser/client previously *initiated* a PKCE
 * exchange (e.g. `signInWithOtp`). An admin-invited user's browser never
 * did that — the invite was created server-side via the service-role
 * client — so even if a `?code=` were present, `exchangeCodeForSession`
 * would throw `AuthPKCECodeVerifierMissingError`. Concretely: invite
 * emails always use the **implicit** grant (`#access_token=...&type=invite`
 * fragment), regardless of the project's/browser client's configured
 * `flowType` for other auth methods.
 *
 * That fragment is processed automatically by the Supabase JS client on
 * initialization (`detectSessionInUrl`, on by default in a browser
 * client) — no manual code needed for it to establish a session. `.
 * auth.getUser()` internally awaits that same initialization promise, so
 * simply calling it here (after `createClient()`) reliably reflects
 * whether a session was established from the URL, without a race.
 *
 * A defensive `?code=` check is still included below in case a future
 * change (or a project misconfiguration) ever does route a PKCE code
 * through this page — it's wrapped so a failure there doesn't block
 * falling through to the implicit-flow check, which is what should
 * actually fire for invites per the reasoning above.
 */
export default function AcceptInvitePage() {
  const router = useRouter();

  const [phase, setPhase]   = useState<'checking' | 'ready' | 'invalid'>('checking');
  const [email, setEmail]   = useState('');
  const [token, setToken]   = useState('');

  const [password, setPassword]               = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw]                   = useState(false);
  const [submitting, setSubmitting]           = useState(false);
  const [error, setError]                     = useState('');
  const [done, setDone]                       = useState(false);

  useEffect(() => {
    async function establishSession() {
      const params = new URLSearchParams(window.location.search);
      const tokenParam = params.get('token') ?? '';
      setToken(tokenParam);

      const supabase = createClient();

      // Defensive PKCE handling — see the file-level comment. Wrapped so a
      // failure here (e.g. no code_verifier stored, exactly as expected
      // for an invite) doesn't prevent falling through to the implicit-
      // flow session check below, which is the path invites actually use.
      const code = params.get('code');
      if (code) {
        try {
          await supabase.auth.exchangeCodeForSession(code);
        } catch {
          // Expected for invite links (see file-level comment) — ignored.
        }
      }

      const { data: { user } } = await supabase.auth.getUser();

      if (!user || !tokenParam) {
        setPhase('invalid');
        return;
      }

      setEmail(user.email ?? '');
      setPhase('ready');
    }

    establishSession();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    const supabase = createClient();

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setSubmitting(false);
      setError(updateError.message);
      return;
    }

    const res = await fetch('/api/team/accept-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setSubmitting(false);
      setError(body.error || 'Failed to accept invitation.');
      return;
    }

    setSubmitting(false);
    setDone(true);
    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div style={{ width: '100%', maxWidth: 420, padding: '0 20px' }}>
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)', padding: '28px 36px 36px',
        boxShadow: '0 8px 32px rgba(0,0,0,.08)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, marginBottom: 20 }}>
          <img src="/logo-ne.png" alt="Neu Entity" style={{ height: 80, width: 'auto', display: 'block' }} />
          <div style={{ fontSize: 11, color: 'var(--fg3)', letterSpacing: '0.05em' }}>Website Manager</div>
        </div>

        {phase === 'checking' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '32px 0' }}>
            <Loader2 size={22} color="var(--ne-blue)" style={{ animation: 'spin .6s linear infinite' }} />
            <div style={{ fontSize: 13, color: 'var(--fg3)' }}>Verifying your invitation...</div>
          </div>
        )}

        {phase === 'invalid' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '16px 0' }}>
            <AlertCircle size={26} color="var(--ne-danger)" />
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--fg1)', textAlign: 'center' }}>
              Invitation link invalid or expired
            </div>
            <p style={{ fontSize: 13, color: 'var(--fg3)', textAlign: 'center', margin: 0 }}>
              This invite link couldn&apos;t be verified. Ask whoever invited you to send a new
              invitation, or sign in below if you already have an account.
            </p>
            <a href="/login" className="btn-outline-ne" style={{ marginTop: 8 }}>Go to sign in</a>
          </div>
        )}

        {phase === 'ready' && !done && (
          <>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--fg1)', margin: '0 0 4px' }}>
              Set your password
            </h1>
            <p style={{ fontSize: 13, color: 'var(--fg3)', margin: '0 0 28px' }}>
              {email ? <>Finishing setup for <strong style={{ color: 'var(--fg1)' }}>{email}</strong></> : 'Finishing setup for your account'}
            </p>

            <form onSubmit={handleSubmit}>
              {error && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                  background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 'var(--r-sm)',
                  marginBottom: 18, fontSize: 13, color: 'var(--ne-danger)',
                }}>
                  <AlertCircle size={14} />
                  {error}
                </div>
              )}

              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 }}>
                  New password
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="At least 8 characters"
                    style={{
                      width: '100%', padding: '10px 44px 10px 14px', fontSize: 13.5,
                      border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
                      background: 'var(--surface)', color: 'var(--fg1)', outline: 'none',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    style={{
                      position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 2,
                    }}
                  >
                    {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 }}>
                  Confirm password
                </label>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  style={{
                    width: '100%', padding: '10px 14px', fontSize: 13.5,
                    border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
                    background: 'var(--surface)', color: 'var(--fg1)', outline: 'none',
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                style={{
                  width: '100%', padding: '11px', borderRadius: 'var(--r-sm)',
                  background: submitting ? 'var(--surface-3)' : 'var(--ne-blue)',
                  color: submitting ? 'var(--fg3)' : '#fff',
                  border: 'none', fontSize: 14, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                {submitting ? (
                  <>
                    <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} />
                    Setting up your account...
                  </>
                ) : (
                  <><KeyRound size={15} /> Set password &amp; continue</>
                )}
              </button>
            </form>
          </>
        )}

        {done && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '16px 0' }}>
            <CheckCircle size={26} color="var(--ne-success)" />
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg1)' }}>You&apos;re all set</div>
            <div style={{ fontSize: 13, color: 'var(--fg3)' }}>Taking you to your dashboard...</div>
          </div>
        )}
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
