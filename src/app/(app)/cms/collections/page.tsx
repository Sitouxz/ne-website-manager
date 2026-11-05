'use client';

import Topbar from '@/components/Topbar';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { collectionBlueprints, getCollectionBlueprint } from '@/lib/templates/catalog';
import { Plus, Loader2, Lock, ShieldCheck, X, Boxes } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSelectedClient } from '@/components/AppShell';
import type { Collection } from '@/lib/supabase/types';
import { EmptyState } from '@/components/EmptyState';

/**
 * Collection list — Task 4.2. Deliberately scoped to `storage='generic'`
 * collections for the "New Collection" + schema-builder flow; `native`
 * (backed by posts/pages/properties) and global (`client_id IS NULL`)
 * collections are surfaced read-only with a badge so ne_admin can see they
 * exist, but are never linked into the schema builder (Task 4.3 territory).
 *
 * Entry counts: shown as a static "—" rather than a per-collection COUNT
 * query against `collection_items` — with N collections that's N extra
 * round-trips on every list load for a number that's rarely load-bearing
 * here. Acceptable simplification per the task brief; revisit with a single
 * grouped RPC/view if the count becomes genuinely needed.
 */
export default function CollectionsPage() {
  const router = useRouter();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading,      setLoading]     = useState(true);
  const [isAdmin,      setIsAdmin]     = useState(false);
  const { selectedClientId } = useSelectedClient();

  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newName,         setNewName]         = useState('');
  const [newNameSingular, setNewNameSingular] = useState('');
  const [newSlug,         setNewSlug]         = useState('');
  const [slugTouched,     setSlugTouched]     = useState(false);
  const [creating,        setCreating]        = useState(false);
  const [createError,     setCreateError]     = useState('');
  // '' means a blank collection — the previous, and still default, behaviour.
  const [blueprintSlug,   setBlueprintSlug]   = useState('');

  const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  useEffect(() => {
    async function loadRole() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
      setIsAdmin(profile?.role === 'ne_admin');
    }
    loadRole();
  }, []);

  const fetchCollections = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    let query = supabase.from('collections').select('*').order('sort_order', { ascending: true }).order('name', { ascending: true });
    query = selectedClientId
      ? query.or(`client_id.eq.${selectedClientId},client_id.is.null`)
      : query.is('client_id', null);
    const { data } = await query;
    setCollections((data ?? []) as Collection[]);
    setLoading(false);
  }, [selectedClientId]);

  useEffect(() => {
    const timer = window.setTimeout(() => fetchCollections(), 0);
    return () => window.clearTimeout(timer);
  }, [fetchCollections]);

  function handleNameChange(value: string) {
    setNewName(value);
    if (!slugTouched) setNewSlug(slugify(value));
  }

  /**
   * Picking a blueprint prefills the three name fields, but only ones the
   * operator has not typed into — someone who has already named this
   * "Whats On" should not have it silently renamed to "Events" by choosing a
   * starting point for its fields.
   */
  function handleBlueprintChange(slug: string) {
    setBlueprintSlug(slug);
    const blueprint = getCollectionBlueprint(slug);
    if (!blueprint) return;

    if (!newName.trim()) setNewName(blueprint.name);
    if (!newNameSingular.trim()) setNewNameSingular(blueprint.name_singular);
    if (!slugTouched && !newSlug.trim()) setNewSlug(blueprint.slug);
  }

  function closeNewDialog() {
    setShowNewDialog(false);
    setNewName('');
    setNewNameSingular('');
    setNewSlug('');
    setSlugTouched(false);
    setBlueprintSlug('');
    setCreateError('');
  }

  async function handleCreate() {
    setCreateError('');
    const name = newName.trim();
    const nameSingular = newNameSingular.trim();
    const slug = newSlug.trim();

    if (!name) { setCreateError('Name is required.'); return; }
    if (!nameSingular) { setCreateError('Singular name is required.'); return; }
    if (!slug) { setCreateError('Slug is required.'); return; }
    if (!selectedClientId) { setCreateError('Select a client in the sidebar first.'); return; }

    const blueprint = getCollectionBlueprint(blueprintSlug);

    setCreating(true);
    const supabase = createClient();
    const { data: created, error } = await supabase
      .from('collections')
      .insert({
        client_id: selectedClientId,
        slug,
        name,
        name_singular: nameSingular,
        storage: 'generic',
        // The blueprint supplies the schema; the operator's typed name/slug
        // always win, so "Events" can be created as "Whats On" without
        // losing the fields.
        description: blueprint?.description ?? null,
        icon: blueprint?.icon ?? null,
        fields: blueprint?.fields ?? [],
        options: blueprint?.options ?? {},
      })
      .select()
      .single();
    setCreating(false);

    if (error) { setCreateError(error.message); return; }
    router.push(`/cms/collections/${created.id}/schema`);
  }

  const selectedBlueprint = getCollectionBlueprint(blueprintSlug);

  const editableFor = (c: Collection) => c.storage === 'generic' && c.client_id !== null && isAdmin;

  return (
    <>
      <Topbar title="Collections" subtitle={`${collections.length} collections`} />
      <div className="page-body">

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          {isAdmin && (
            <button className="btn-ne" onClick={() => setShowNewDialog(true)}>
              <Plus size={15} /> New Collection
            </button>
          )}
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden', marginBottom: 20 }}>
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 20 }}>Collection</th>
                  <th>Icon</th>
                  <th>Fields</th>
                  <th>Entries</th>
                  <th>Type</th>
                  <th style={{ width: 100 }}></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="table-placeholder">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        <Loader2 size={16} className="spin" /> Loading...
                      </div>
                    </td>
                  </tr>
                ) : collections.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 0 }}>
                      {/* Points at the ready-made starting points rather than
                          just reporting emptiness — the blueprint picker is
                          the fastest route out of this state, and nothing
                          else on screen mentions it exists. */}
                      <EmptyState
                        icon={Boxes}
                        title="No collections yet"
                        body={isAdmin
                          ? 'Collections hold repeating content — services, events, listings, staff. Start from a ready-made one and adjust it, or build the fields yourself.'
                          : 'Collections hold repeating content like services or events. Ask Neu Entity to set one up for this website.'}
                        actionLabel={isAdmin ? 'Add a collection' : undefined}
                        onAction={isAdmin ? () => setShowNewDialog(true) : undefined}
                      />
                    </td>
                  </tr>
                ) : collections.map((c) => {
                  const editable = editableFor(c);
                  const isGlobal = c.client_id === null;
                  const isNative = c.storage === 'native';
                  return (
                    <tr key={c.id}>
                      <td style={{ paddingLeft: 20, maxWidth: 320 }}>
                        {editable ? (
                          <Link href={`/cms/collections/${c.id}/schema`} style={{ color: 'var(--fg1)', textDecoration: 'none', fontWeight: 600, fontSize: 13.5 }}>
                            {c.name || '(Untitled)'}
                          </Link>
                        ) : (
                          <span style={{ color: 'var(--fg1)', fontWeight: 600, fontSize: 13.5 }}>{c.name || '(Untitled)'}</span>
                        )}
                        <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 2 }}>{c.name_singular}</div>
                        <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 1 }}>/{c.slug}</div>
                      </td>
                      <td>
                        <code style={{ fontSize: 11.5, color: 'var(--fg3)' }}>{c.icon || '—'}</code>
                      </td>
                      <td style={{ color: 'var(--fg2)', fontSize: 13 }}>{c.fields?.length ?? 0}</td>
                      <td style={{ color: 'var(--fg3)', fontSize: 13 }}>—</td>
                      <td>
                        {isGlobal ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, background: 'var(--surface-3)', padding: '3px 8px', borderRadius: 99, color: 'var(--fg2)', fontWeight: 600 }}>
                            <ShieldCheck size={11} /> System
                          </span>
                        ) : isNative ? (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, background: 'var(--surface-3)', padding: '3px 8px', borderRadius: 99, color: 'var(--fg2)', fontWeight: 600 }}>
                            <Lock size={11} /> Native — read-only
                          </span>
                        ) : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, background: 'var(--ne-blue-bg, var(--surface-3))', padding: '3px 8px', borderRadius: 99, color: 'var(--fg2)', fontWeight: 600 }}>
                            <Boxes size={11} /> Generic
                          </span>
                        )}
                      </td>
                      <td>
                        {editable && (
                          <Link href={`/cms/collections/${c.id}/schema`} className="btn-outline-ne" style={{ fontSize: 11.5, padding: '5px 10px' }}>
                            Edit Schema
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showNewDialog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)', padding: '28px 32px', width: 460, boxShadow: '0 16px 48px rgba(0,0,0,.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ fontWeight: 800, fontSize: 16 }}>New Collection</div>
              <button onClick={closeNewDialog} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)' }}><X size={18} /></button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {createError && (
                <div className="error-box">
                  {createError}
                </div>
              )}
              <div>
                <label htmlFor="new-collection-blueprint" className="field-label">
                  Start from
                </label>
                <select
                  id="new-collection-blueprint"
                  value={blueprintSlug}
                  onChange={(e) => handleBlueprintChange(e.target.value)}
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13.5, color: 'var(--fg1)', background: 'var(--surface)' }}
                >
                  <option value="">Nothing — build the fields myself</option>
                  {collectionBlueprints().map((b) => (
                    <option key={b.slug} value={b.slug}>{b.name} ({b.fromTemplate})</option>
                  ))}
                </select>
                {selectedBlueprint && (
                  <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 6 }}>
                    {selectedBlueprint.description} Comes with {selectedBlueprint.fields.length} fields ready to use.
                  </div>
                )}
              </div>
              <div>
                <label className="field-label">Name (plural)</label>
                <input
                  value={newName}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="Testimonials"
                  autoFocus
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13.5, outline: 'none', color: 'var(--fg1)' }}
                />
              </div>
              <div>
                <label className="field-label">Singular name</label>
                <input
                  value={newNameSingular}
                  onChange={(e) => setNewNameSingular(e.target.value)}
                  placeholder="Testimonial"
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13.5, outline: 'none', color: 'var(--fg1)' }}
                />
              </div>
              <div>
                <label className="field-label">Slug</label>
                <input
                  value={newSlug}
                  onChange={(e) => { setNewSlug(e.target.value); setSlugTouched(true); }}
                  placeholder="testimonials"
                  style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', fontSize: 13, outline: 'none', color: 'var(--ne-blue)', fontFamily: 'monospace' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-ne" style={{ flex: 1, justifyContent: 'center' }} onClick={handleCreate} disabled={creating}>
                  {creating ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
                  Create
                </button>
                <button className="btn-outline-ne" onClick={closeNewDialog}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
