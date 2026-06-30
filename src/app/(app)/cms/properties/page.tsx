'use client';

import Topbar from '@/components/Topbar';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Plus, Search, MoreHorizontal, Edit, Trash2, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSelectedClient } from '@/components/AppShell';
import type { Property } from '@/lib/supabase/types';

const STATUSES = ['All', 'active', 'archived'];
const LISTINGS = ['All', 'sale', 'rent'];

export default function PropertiesPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState('');
  const [status,     setStatus]     = useState('All');
  const [listing,    setListing]    = useState('All');
  const [openMenu,   setOpenMenu]   = useState<string | null>(null);
  const [deleting,   setDeleting]   = useState<string | null>(null);
  const { selectedClientId } = useSelectedClient();

  const fetchProperties = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    let query = supabase
      .from('properties')
      .select('*')
      .order('created_at', { ascending: false });
    if (selectedClientId) query = query.eq('client_id', selectedClientId);
    const { data } = await query;
    setProperties(data ?? []);
    setLoading(false);
  }, [selectedClientId]);

  useEffect(() => {
    const timer = window.setTimeout(() => fetchProperties(), 0);
    return () => window.clearTimeout(timer);
  }, [fetchProperties]);

  async function handleDelete(id: string) {
    if (!confirm('Delete this property? This cannot be undone.')) return;
    setDeleting(id);
    const supabase = createClient();
    await supabase.from('properties').delete().eq('id', id);
    setProperties((prev) => prev.filter((p) => p.id !== id));
    setDeleting(null);
    setOpenMenu(null);
  }

  const filtered = properties.filter((p) =>
    (status  === 'All' || p.status  === status) &&
    (listing === 'All' || p.listing === listing) &&
    (p.name.toLowerCase().includes(search.toLowerCase()) ||
     p.address.toLowerCase().includes(search.toLowerCase()))
  );

  const formatPrice = (p: Property) => {
    if (!p.price) return '—';
    return new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD', maximumFractionDigits: 0 }).format(p.price);
  };

  return (
    <>
      <Topbar title="Properties" subtitle={`${properties.length} listings total`} />
      <div className="page-body">

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {STATUSES.map((s) => (
              <button key={s} onClick={() => setStatus(s)} style={{
                padding: '6px 14px', borderRadius: 99, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: 'none',
                background: status === s ? 'var(--ne-blue)' : 'var(--surface)',
                color:      status === s ? '#fff'          : 'var(--fg2)',
                boxShadow: 'var(--shadow-sm)',
              }}>
                {s === 'All' ? 'All Listings' : s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
          <Link href="/cms/properties/new" className="btn-ne">
            <Plus size={15} /> New Property
          </Link>
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden', marginBottom: 20 }}>

          {/* Search + filter */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 200, background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '7px 12px' }}>
              <Search size={14} color="var(--fg3)" />
              <input
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name or address..."
                style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 13, color: 'var(--fg1)', width: '100%' }}
              />
            </div>
            <select value={listing} onChange={(e) => setListing(e.target.value)}
              style={{ fontSize: 12.5, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '6px 10px', color: 'var(--fg1)', background: 'var(--surface)', cursor: 'pointer' }}>
              {LISTINGS.map((l) => <option key={l}>{l === 'All' ? 'All types' : l === 'sale' ? 'For Sale' : 'For Rent'}</option>)}
            </select>
          </div>

          {/* Table */}
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 20 }}>Property</th>
                  <th>Type</th>
                  <th>Price</th>
                  <th>Status</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 48, color: 'var(--fg3)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                        <Loader2 size={16} style={{ animation: 'spin .6s linear infinite' }} /> Loading...
                      </div>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: 48, color: 'var(--fg3)' }}>
                      {properties.length === 0 ? 'No properties yet. Add your first listing!' : 'No listings match your filters.'}
                    </td>
                  </tr>
                ) : filtered.map((p) => (
                  <tr key={p.id} style={{ position: 'relative' }}>
                    <td style={{ paddingLeft: 20, maxWidth: 320 }}>
                      <Link href={`/cms/properties/${p.id}`} style={{ color: 'var(--fg1)', textDecoration: 'none', fontWeight: 600, fontSize: 13.5 }}>
                        {p.name || '(Untitled)'}
                      </Link>
                      <div style={{ fontSize: 11.5, color: 'var(--fg3)', marginTop: 2 }}>{p.address || '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--fg3)', marginTop: 1 }}>/{p.slug}</div>
                    </td>
                    <td>
                      <span style={{ fontSize: 12, background: 'var(--surface-3)', padding: '3px 8px', borderRadius: 99, color: 'var(--fg2)', fontWeight: 500 }}>
                        {p.listing === 'sale' ? 'For Sale' : 'For Rent'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--fg2)', fontSize: 13, fontWeight: 600 }}>{formatPrice(p)}</td>
                    <td><span className={`status-pill ${p.status}`}>{p.status}</span></td>
                    <td style={{ position: 'relative' }}>
                      <button
                        onClick={() => setOpenMenu(openMenu === p.id ? null : p.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 4, borderRadius: 4 }}
                      >
                        <MoreHorizontal size={16} />
                      </button>
                      {openMenu === p.id && (
                        <div style={{ position: 'absolute', right: 12, top: 36, zIndex: 100, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', boxShadow: 'var(--shadow-md)', minWidth: 140, overflow: 'hidden' }}>
                          <Link href={`/cms/properties/${p.id}`}
                            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px', fontSize: 13, color: 'var(--fg1)', textDecoration: 'none' }}
                            onClick={() => setOpenMenu(null)}>
                            <Edit size={14} /> Edit
                          </Link>
                          <button
                            style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 14px', fontSize: 13, color: 'var(--ne-danger)', background: 'none', border: 'none', cursor: 'pointer', width: '100%' }}
                            onClick={() => handleDelete(p.id)}
                            disabled={deleting === p.id}
                          >
                            {deleting === p.id ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Trash2 size={14} />}
                            Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--fg3)' }}>Showing {filtered.length} of {properties.length} listings</span>
          </div>
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
