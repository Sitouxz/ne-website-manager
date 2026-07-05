'use client';

import Topbar from '@/components/Topbar';
import { useCallback, useEffect, useState } from 'react';
import {
  Plus, Trash2, Loader2, X, Users, ShieldAlert, Clock, Mail,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSelectedClient } from '@/components/AppShell';
import type { Role } from '@/lib/supabase/types';

interface Member {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  role: Role;
  client_id: string | null;
  created_at: string;
  last_sign_in_at: string | null;
}

const ROLE_LABELS: Record<Role, string> = {
  ne_admin: 'NE Admin',
  client_admin: 'Client Admin',
  editor: 'Editor',
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', border: '1px solid var(--border)',
  borderRadius: 'var(--r-sm)', fontSize: 13.5, outline: 'none', color: 'var(--fg1)',
};
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--fg2)', marginBottom: 6 };

function formatDate(value: string | null): string {
  if (!value) return 'Never';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Team page — Task 6.1. `ne_admin`/`client_admin` only; a plain `editor`
 * gets a clear "not authorized" state below (both here and via
 * `src/components/Sidebar.tsx` hiding the nav item entirely) — matching
 * the defense-in-depth pattern from the collections schema page (Task
 * 4.2) and the redirects RLS tightening (Task 5.3): this client-side gate
 * is a UX nicety, not the real security boundary. The real boundary is
 * `invitations_manage`/`profiles_client_admin_manage` RLS (migration
 * 013_team.sql) plus the app-layer checks in
 * `src/app/api/team/invite/route.ts` and
 * `src/app/api/team/members/route.ts`.
 *
 * Data (the member list, including `last_sign_in_at`) and all mutations
 * (invite / change role / remove) go through `/api/team/*` server routes
 * rather than direct `supabase.from('profiles')` calls — see those
 * routes' file-level comments for why: `profiles_select` RLS only ever
 * lets a `client_admin` see their OWN row, never a teammate's, and there
 * is no `is_ne_admin()` UPDATE policy on `profiles` at all, so the
 * server-side admin client is required either way.
 */
export default function TeamPage() {
  const { selectedClientId } = useSelectedClient();

  const [checkingRole, setCheckingRole] = useState(true);
  const [myRole, setMyRole] = useState<Role | null>(null);

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'client_admin' | 'editor'>('editor');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteSuccess, setInviteSuccess] = useState('');

  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    async function loadRole() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setCheckingRole(false); return; }
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      setMyRole((profile?.role as Role | undefined) ?? 'editor');
      setCheckingRole(false);
    }
    loadRole();
  }, []);

  const canManageTeam = myRole === 'ne_admin' || myRole === 'client_admin';

  const fetchMembers = useCallback(async () => {
    if (!selectedClientId || !canManageTeam) { setMembers([]); setLoading(false); return; }
    setLoading(true);
    setListError('');
    const res = await fetch(`/api/team/members?client_id=${selectedClientId}`);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setListError(body.error || 'Failed to load team members.');
      setMembers([]);
      setLoading(false);
      return;
    }
    setMembers(await res.json());
    setLoading(false);
  }, [selectedClientId, canManageTeam]);

  useEffect(() => {
    if (checkingRole) return;
    const timer = window.setTimeout(() => fetchMembers(), 0);
    return () => window.clearTimeout(timer);
  }, [checkingRole, fetchMembers]);

  function closeInviteDialog() {
    setShowInvite(false);
    setInviteEmail('');
    setInviteRole('editor');
    setInviteError('');
  }

  async function handleInvite() {
    setInviteError('');
    const email = inviteEmail.trim();
    if (!email) { setInviteError('Email is required.'); return; }
    if (!selectedClientId) { setInviteError('Select a client in the sidebar first.'); return; }

    setInviting(true);
    const res = await fetch('/api/team/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role: inviteRole, client_id: selectedClientId }),
    });
    const body = await res.json().catch(() => ({}));
    setInviting(false);

    if (!res.ok) { setInviteError(body.error || 'Failed to send invitation.'); return; }

    closeInviteDialog();
    setInviteSuccess(`Invitation sent to ${email}.`);
    setTimeout(() => setInviteSuccess(''), 4000);
  }

  async function handleRoleChange(member: Member, role: Role) {
    setBusyId(member.id);
    const res = await fetch('/api/team/members', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: member.id, role }),
    });
    setBusyId(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      window.alert(body.error || 'Failed to change role.');
      return;
    }
    await fetchMembers();
  }

  async function handleRemove(member: Member) {
    if (!window.confirm(`Remove ${member.full_name || 'this member'} from the team? They will lose access to this client but their account is not deleted.`)) return;
    setBusyId(member.id);
    const res = await fetch('/api/team/members', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: member.id, remove: true }),
    });
    setBusyId(null);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      window.alert(body.error || 'Failed to remove member.');
      return;
    }
    await fetchMembers();
  }

  if (checkingRole) {
    return (
      <>
        <Topbar title="Team Members" />
        <div className="page-body" style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
          <Loader2 size={24} color="var(--ne-blue)" style={{ animation: 'spin .6s linear infinite' }} />
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </>
    );
  }

  if (!canManageTeam) {
    return (
      <>
        <Topbar title="Team Members" />
        <div className="page-body">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '64px 24px', color: 'var(--fg3)' }}>
            <ShieldAlert size={28} color="var(--ne-danger)" />
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--fg1)' }}>Not authorized</div>
            <div style={{ fontSize: 13, textAlign: 'center', maxWidth: 360 }}>
              Only client admins and NE admins can view or manage team members.
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar title="Team Members" subtitle={`${members.length} member${members.length === 1 ? '' : 's'}`} />
      <div className="page-body">
        {!selectedClientId ? (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 32, color: 'var(--fg3)', fontSize: 13.5 }}>
            Select a client in the sidebar first.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12, marginBottom: 20 }}>
              {inviteSuccess && (
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ne-success)' }}>{inviteSuccess}</div>
              )}
              <button className="btn-ne" onClick={() => setShowInvite(true)}>
                <Plus size={15} /> Invite Member
              </button>
            </div>

            {listError && (
              <div style={{ padding: '12px 16px', background: '#FEF2F2', color: 'var(--ne-danger)', borderRadius: 'var(--r-sm)', fontSize: 13, marginBottom: 16 }}>
                {listError}
              </div>
            )}

            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
              <div className="table-responsive">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ paddingLeft: 20 }}>Member</th>
                      <th>Role</th>
                      <th>Last sign-in</th>
                      <th style={{ width: 140 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={4} style={{ textAlign: 'center', padding: 48, color: 'var(--fg3)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                            <Loader2 size={16} style={{ animation: 'spin .6s linear infinite' }} /> Loading...
                          </div>
                        </td>
                      </tr>
                    ) : members.length === 0 ? (
                      <tr>
                        <td colSpan={4} style={{ textAlign: 'center', padding: 48, color: 'var(--fg3)' }}>
                          No team members yet. Invite your first one!
                        </td>
                      </tr>
                    ) : members.map((m) => (
                      <tr key={m.id}>
                        <td style={{ paddingLeft: 20 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Users size={14} color="var(--fg3)" />
                            <span style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--fg1)' }}>{m.full_name || 'Unnamed user'}</span>
                          </div>
                        </td>
                        <td>
                          <select
                            value={m.role}
                            disabled={busyId === m.id}
                            onChange={(e) => handleRoleChange(m, e.target.value as Role)}
                            style={{ ...inputStyle, width: 'auto', padding: '6px 10px', fontSize: 12.5, background: 'var(--surface)' }}
                          >
                            <option value="editor">{ROLE_LABELS.editor}</option>
                            <option value="client_admin">{ROLE_LABELS.client_admin}</option>
                            {myRole === 'ne_admin' && <option value="ne_admin">{ROLE_LABELS.ne_admin}</option>}
                          </select>
                        </td>
                        <td style={{ color: 'var(--fg2)', fontSize: 13 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Clock size={12} color="var(--fg3)" />
                            {formatDate(m.last_sign_in_at)}
                          </div>
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button
                              onClick={() => handleRemove(m)}
                              disabled={busyId === m.id}
                              style={{ background: 'none', border: 'none', cursor: busyId === m.id ? 'default' : 'pointer', color: 'var(--ne-danger)', padding: 6 }}
                              aria-label={`Remove ${m.full_name || 'member'}`}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>

      {showInvite && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '28px 32px', width: 440, boxShadow: '0 16px 48px rgba(0,0,0,.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>Invite Team Member</div>
              <button onClick={closeInviteDialog} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)' }}><X size={18} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {inviteError && (
                <div style={{ padding: '10px 14px', background: '#FEF2F2', color: 'var(--ne-danger)', borderRadius: 'var(--r-sm)', fontSize: 13 }}>
                  {inviteError}
                </div>
              )}
              <div>
                <label style={labelStyle}>Email</label>
                <div style={{ position: 'relative' }}>
                  <Mail size={14} color="var(--fg3)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="teammate@example.com"
                    autoFocus
                    style={{ ...inputStyle, paddingLeft: 34 }}
                  />
                </div>
              </div>
              <div>
                <label style={labelStyle}>Role</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'client_admin' | 'editor')}
                  style={{ ...inputStyle, background: 'var(--surface)' }}
                >
                  <option value="editor">{ROLE_LABELS.editor}</option>
                  <option value="client_admin">{ROLE_LABELS.client_admin}</option>
                </select>
                <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 6 }}>
                  NE Admin access can&apos;t be granted through an invitation.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-ne" style={{ flex: 1, justifyContent: 'center' }} onClick={handleInvite} disabled={inviting}>
                  {inviting ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Plus size={14} />}
                  Send Invite
                </button>
                <button className="btn-outline-ne" onClick={closeInviteDialog}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
