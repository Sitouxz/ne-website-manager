'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, LogIn, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });

    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    router.push('/dashboard');
    router.refresh();
  }

  return (
    <div style={{ width: '100%', maxWidth: 420, padding: '0 20px' }}>

      {/* Card */}
      <div style={{
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-lg)', padding: '40px 36px',
        boxShadow: '0 8px 32px rgba(0,0,0,.08)',
      }}>

        {/* Logo */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginBottom: 32 }}>
          <img src="/logo-ne.svg" alt="Neu Entity" style={{ height: 64, width: 'auto' }} />
          <div style={{ fontSize: 11, color: 'var(--fg3)', letterSpacing: '0.05em' }}>Website Manager</div>
        </div>

        <h1 style={{ fontSize: 20, fontWeight: 800, color: 'var(--fg1)', margin: '0 0 4px' }}>
          Sign in to your account
        </h1>
        <p style={{ fontSize: 13, color: 'var(--fg3)', margin: '0 0 28px' }}>
          Enter your credentials to access the dashboard
        </p>

        <form onSubmit={handleLogin}>

          {/* Error */}
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

          {/* Email */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 }}>
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              style={{
                width: '100%', padding: '10px 14px', fontSize: 13.5,
                border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
                background: 'var(--surface)', color: 'var(--fg1)', outline: 'none',
                transition: 'border-color .15s',
              }}
              onFocus={(e) => e.target.style.borderColor = 'var(--ne-blue)'}
              onBlur={(e)  => e.target.style.borderColor = 'var(--border)'}
            />
          </div>

          {/* Password */}
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 }}>
              Password
            </label>
            <div style={{ position: 'relative' }}>
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                style={{
                  width: '100%', padding: '10px 44px 10px 14px', fontSize: 13.5,
                  border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
                  background: 'var(--surface)', color: 'var(--fg1)', outline: 'none',
                  transition: 'border-color .15s',
                }}
                onFocus={(e) => e.target.style.borderColor = 'var(--ne-blue)'}
                onBlur={(e)  => e.target.style.borderColor = 'var(--border)'}
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

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '11px', borderRadius: 'var(--r-sm)',
              background: loading ? 'var(--surface-3)' : 'var(--ne-blue)',
              color: loading ? 'var(--fg3)' : '#fff',
              border: 'none', fontSize: 14, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'background .15s',
            }}
          >
            {loading ? (
              <>
                <div style={{ width: 14, height: 14, border: '2px solid var(--fg3)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
                Signing in...
              </>
            ) : (
              <><LogIn size={15} /> Sign in</>
            )}
          </button>
        </form>
      </div>

      {/* Footer */}
      <p style={{ textAlign: 'center', fontSize: 12, color: 'var(--fg3)', marginTop: 20 }}>
        Access provided by{' '}
        <a href="https://neuentity.com" target="_blank" rel="noopener" style={{ color: 'var(--ne-blue)', fontWeight: 600, textDecoration: 'none' }}>
          Neu Entity
        </a>
        . Contact your account manager for access.
      </p>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
