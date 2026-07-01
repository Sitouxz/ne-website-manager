'use client';

import Topbar from '@/components/Topbar';
import { useEffect, useState } from 'react';
import { Plus, X, ArrowUp, ArrowDown, Loader2, Eye, EyeOff } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useResolvedClient, useAllCollections } from '@/lib/collections/useCollection';
import { getIcon } from '@/lib/collections/icons';
import type { MenuItem, MenuLocation, MenuLinkType } from '@/lib/supabase/types';

const inputStyle: React.CSSProperties = {
  border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
  padding: '8px 10px', fontSize: 13, color: 'var(--fg1)', background: 'var(--surface)', outline: 'none',
};

const LOCATIONS: { value: MenuLocation; label: string; help: string }[] = [
  { value: 'cms_sidebar', label: 'CMS Sidebar', help: 'Links shown in this admin panel for the selected client.' },
  { value: 'public', label: 'Public Site Nav', help: 'Navigation served to the client’s public website via the SDK.' },
];

export default function MenusPage() {
  const { clientId, loading: clientLoading } = useResolvedClient();
  const { collections } = useAllCollections();
  const [location, setLocation] = useState<MenuLocation>('cms_sidebar');
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [label, setLabel] = useState('');
  const [icon, setIcon] = useState('Link');
  const [linkType, setLinkType] = useState<MenuLinkType>('collection');
  const [collectionSlug, setCollectionSlug] = useState('');
  const [url, setUrl] = useState('');

  async function fetchMenuItems(clientId: string, location: MenuLocation) {
    const supabase = createClient();
    const { data } = await supabase
      .from('menu_items')
      .select('*')
      .eq('client_id', clientId)
      .eq('location', location)
      .order('sort_order', { ascending: true });
    return (data as MenuItem[]) ?? [];
  }

  async function load() {
    if (!clientId) { setItems([]); setLoading(false); return; }
    setLoading(true);
    setItems(await fetchMenuItems(clientId, location));
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    async function initial() {
      if (!clientId) { if (!cancelled) { setItems([]); setLoading(false); } return; }
      setLoading(true);
      const result = await fetchMenuItems(clientId, location);
      if (!cancelled) { setItems(result); setLoading(false); }
    }
    if (!clientLoading) initial();
    return () => { cancelled = true; };
  }, [clientLoading, clientId, location]);

  async function handleAdd() {
    if (!clientId) { setError('Select a client in the sidebar first.'); return; }
    if (!label.trim()) { setError('Label is required.'); return; }
    if (linkType === 'collection' && !collectionSlug) { setError('Choose a collection to link to.'); return; }
    if (linkType === 'url' && !url.trim()) { setError('Enter a URL.'); return; }

    setError('');
    const supabase = createClient();
    const { error: err } = await supabase.from('menu_items').insert({
      client_id: clientId,
      location,
      label: label.trim(),
      icon: icon.trim() || 'Link',
      link_type: linkType,
      collection_slug: linkType === 'collection' ? collectionSlug : null,
      url: linkType === 'url' ? url.trim() : null,
      sort_order: items.length,
    });
    if (err) { setError(err.message); return; }
    setLabel(''); setUrl(''); setCollectionSlug('');
    load();
  }

  async function handleDelete(id: string) {
    const supabase = createClient();
    await supabase.from('menu_items').delete().eq('id', id);
    load();
  }

  async function handleToggleVisible(item: MenuItem) {
    const supabase = createClient();
    await supabase.from('menu_items').update({ is_visible: !item.is_visible }).eq('id', item.id);
    load();
  }

  async function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const supabase = createClient();
    const a = items[i], b = items[j];
    await Promise.all([
      supabase.from('menu_items').update({ sort_order: b.sort_order }).eq('id', a.id),
      supabase.from('menu_items').update({ sort_order: a.sort_order }).eq('id', b.id),
    ]);
    load();
  }

  return (
    <>
      <Topbar title="Menus" subtitle="Build the sidebar and public site navigation per client" />
      <div className="page-body">
        <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
          {LOCATIONS.map((loc) => (
            <button key={loc.value} onClick={() => setLocation(loc.value)} style={{
              padding: '6px 14px', borderRadius: 99, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: 'none',
              background: location === loc.value ? 'var(--ne-blue)' : 'var(--surface)',
              color:      location === loc.value ? '#fff'          : 'var(--fg2)',
              boxShadow: 'var(--shadow-sm)',
            }}>
              {loc.label}
            </button>
          ))}
        </div>
        <p style={{ fontSize: 13, color: 'var(--fg3)', marginTop: -12, marginBottom: 20 }}>
          {LOCATIONS.find((l) => l.value === location)?.help}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
            {loading || clientLoading ? (
              <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg3)' }}>
                <Loader2 size={16} style={{ animation: 'spin .6s linear infinite' }} />
              </div>
            ) : items.length === 0 ? (
              <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg3)', fontSize: 13.5 }}>No items yet — add one on the right.</div>
            ) : (
              items.map((item, i) => {
                const Icon = getIcon(item.icon);
                return (
                  <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: i < items.length - 1 ? '1px solid var(--border)' : undefined, opacity: item.is_visible ? 1 : 0.5 }}>
                    <Icon size={16} color="var(--ne-blue)" />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--fg1)' }}>{item.label}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--fg3)' }}>
                        {item.link_type === 'collection' ? `Collection: ${item.collection_slug}` : item.link_type === 'url' ? item.url : 'Custom'}
                      </div>
                    </div>
                    <button onClick={() => handleToggleVisible(item)} title={item.is_visible ? 'Visible' : 'Hidden'} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)' }}>
                      {item.is_visible ? <Eye size={14} /> : <EyeOff size={14} />}
                    </button>
                    <button onClick={() => move(i, -1)} disabled={i === 0} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)' }}><ArrowUp size={14} /></button>
                    <button onClick={() => move(i, 1)} disabled={i === items.length - 1} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)' }}><ArrowDown size={14} /></button>
                    <button onClick={() => handleDelete(item.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ne-danger)' }}><X size={14} /></button>
                  </div>
                );
              })
            )}
          </div>

          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg2)', textTransform: 'uppercase', letterSpacing: '.06em' }}>Add Item</div>
            {error && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ne-danger)', padding: '8px 10px', background: '#FEF2F2', borderRadius: 'var(--r-sm)' }}>{error}</div>}
            <input value={label} onChange={(e) => setLabel(e.target.value)} style={inputStyle} placeholder="Label (e.g. Cars)" />
            <input value={icon} onChange={(e) => setIcon(e.target.value)} style={inputStyle} placeholder="Icon (lucide name, e.g. Car)" />
            <select value={linkType} onChange={(e) => setLinkType(e.target.value as MenuLinkType)} style={{ ...inputStyle, cursor: 'pointer' }}>
              <option value="collection">Link to Collection</option>
              <option value="url">Link to URL</option>
              <option value="custom">Custom (no link)</option>
            </select>
            {linkType === 'collection' && (
              <select value={collectionSlug} onChange={(e) => setCollectionSlug(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">— Choose collection —</option>
                {collections.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
              </select>
            )}
            {linkType === 'url' && (
              <input value={url} onChange={(e) => setUrl(e.target.value)} style={inputStyle} placeholder="/about or https://..." />
            )}
            <button className="btn-ne" style={{ justifyContent: 'center' }} onClick={handleAdd}>
              <Plus size={14} /> Add to {LOCATIONS.find((l) => l.value === location)?.label}
            </button>
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
