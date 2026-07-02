'use client';

import Topbar from '@/components/Topbar';
import Link from 'next/link';
import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Send, Loader2, Plus, X, Image as ImageIcon } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSelectedClient } from '@/components/AppShell';
import { logActivity } from '@/lib/activity';
import MediaPicker from '@/components/MediaPicker';
import type { MediaItem } from '@/app/api/media/route';

const ACTIVITY_LABELS: Record<string, string> = {
  created: 'Created',
  updated: 'Updated',
  published: 'Published',
  archived: 'Archived',
};

const EMPTY_FORM = {
  name: '', slug: '', address: '', area: '', district: '',
  listing: 'sale' as 'sale' | 'rent',
  segment: 'Prime' as 'Prime' | 'City fringe' | 'Suburban',
  property_type: '', tenure: '',
  bedrooms: 0, bathrooms: 0,
  price: '', psf: '', size_sqft: '', completion_year: '', furnishing: '',
  tagline: '', story: '', location_note: '',
  highlights: [] as { label: string; body: string }[],
  connectivity: [] as string[],
  amenities: [] as string[],
  hero_url: '', hero_alt: '',
  gallery: [] as { src: string; alt: string }[],
  available: '', source_url: '',
  status: 'active' as 'active' | 'archived',
  seo_title: '', seo_description: '',
};

type FormState = typeof EMPTY_FORM;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg3)', display: 'block', marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)',
  padding: '8px 10px', fontSize: 13, color: 'var(--fg1)', background: 'var(--surface)', outline: 'none',
};

export default function PropertyEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const isNew  = id === 'new';
  const router = useRouter();

  const [form,    setForm]    = useState<FormState>({ ...EMPTY_FORM });
  const [loading, setLoading] = useState(!isNew);
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [error,   setError]   = useState('');
  const [clientId, setClientId] = useState<string | null>(null);
  const [isAdmin,  setIsAdmin]  = useState(false);

  // List helpers
  const [newConnectivity, setNewConnectivity] = useState('');
  const [newAmenity,      setNewAmenity]      = useState('');
  const [newHlLabel,      setNewHlLabel]      = useState('');
  const [newHlBody,       setNewHlBody]       = useState('');
  const [newGalSrc,       setNewGalSrc]       = useState('');
  const [newGalAlt,       setNewGalAlt]       = useState('');

  // MediaPicker: one instance, `pickerMode` tracks which field it's filling.
  const [pickerMode, setPickerMode] = useState<'hero' | 'gallery' | null>(null);

  const { selectedClientId } = useSelectedClient();

  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const set = (k: keyof FormState, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles').select('client_id, role').eq('id', user.id).single();

      const admin = profile?.role === 'ne_admin';
      setIsAdmin(admin);

      if (admin) {
        if (isNew) setClientId(selectedClientId ?? null);
      } else {
        setClientId(profile?.client_id ?? null);
      }

      if (!isNew) {
        const { data: prop } = await supabase
          .from('properties').select('*').eq('id', id).single();

        if (prop) {
          if (admin) setClientId(prop.client_id);
          setForm({
            name:          prop.name          ?? '',
            slug:          prop.slug          ?? '',
            address:       prop.address       ?? '',
            area:          prop.area          ?? '',
            district:      prop.district      ?? '',
            listing:       prop.listing       ?? 'sale',
            segment:       prop.segment       ?? 'Prime',
            property_type: prop.property_type ?? '',
            tenure:        prop.tenure        ?? '',
            bedrooms:      prop.bedrooms      ?? 0,
            bathrooms:     prop.bathrooms     ?? 0,
            price:         prop.price         != null ? String(prop.price) : '',
            psf:           prop.psf           != null ? String(prop.psf)   : '',
            size_sqft:     prop.size_sqft     != null ? String(prop.size_sqft) : '',
            completion_year: prop.completion_year != null ? String(prop.completion_year) : '',
            furnishing:    prop.furnishing    ?? '',
            tagline:       prop.tagline       ?? '',
            story:         prop.story         ?? '',
            location_note: prop.location_note ?? '',
            highlights:    prop.highlights    ?? [],
            connectivity:  prop.connectivity  ?? [],
            amenities:     prop.amenities     ?? [],
            hero_url:      prop.hero_url      ?? '',
            hero_alt:      prop.hero_alt      ?? '',
            gallery:       prop.gallery       ?? [],
            available:     prop.available     ?? '',
            source_url:    prop.source_url    ?? '',
            status:        prop.status        ?? 'active',
            seo_title:     prop.seo_title     ?? '',
            seo_description: prop.seo_description ?? '',
          });
        }
        setLoading(false);
      }
    }
    load();
  }, [id, isNew, selectedClientId]);

  async function handleSave(statusOverride?: 'active' | 'archived') {
    if (!clientId) { setError('No client linked. Contact Neu Entity support.'); return; }
    setSaving(true); setError('');

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setError('Not authenticated'); setSaving(false); return; }

    const previousStatus = form.status;
    const newStatus = statusOverride ?? form.status;

    const payload = {
      name:           form.name || '(Untitled)',
      slug:           form.slug || slugify(form.name) || 'untitled',
      address:        form.address,
      area:           form.area,
      district:       form.district,
      listing:        form.listing,
      segment:        form.segment,
      property_type:  form.property_type,
      tenure:         form.tenure,
      bedrooms:       Number(form.bedrooms) || 0,
      bathrooms:      Number(form.bathrooms) || 0,
      price:          form.price          ? Number(form.price)          : null,
      psf:            form.psf            ? Number(form.psf)            : null,
      size_sqft:      form.size_sqft      ? Number(form.size_sqft)      : null,
      completion_year:form.completion_year? Number(form.completion_year): null,
      furnishing:     form.furnishing     || null,
      tagline:        form.tagline,
      story:          form.story,
      location_note:  form.location_note,
      highlights:     form.highlights,
      connectivity:   form.connectivity,
      amenities:      form.amenities,
      hero_url:       form.hero_url,
      hero_alt:       form.hero_alt,
      gallery:        form.gallery,
      available:      form.available      || null,
      source_url:     form.source_url     || null,
      status:         newStatus,
      seo_title:      form.seo_title      || null,
      seo_description:form.seo_description|| null,
    };

    if (isNew) {
      const { data: newProp, error: err } = await supabase
        .from('properties')
        .insert({ ...payload, client_id: clientId })
        .select().single();
      if (err) { setError(err.message); setSaving(false); return; }

      const action = newStatus === 'archived' ? 'archived' : 'created';
      await logActivity(supabase, {
        clientId,
        actorId: user.id,
        action,
        entityType: 'property',
        entityId: newProp.id,
        summary: `${ACTIVITY_LABELS[action]} "${payload.name}"`,
      });

      setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
      router.replace(`/cms/properties/${newProp.id}`);
    } else {
      const { error: err } = await supabase
        .from('properties').update(payload).eq('id', id);
      if (err) { setError(err.message); setSaving(false); return; }
      if (statusOverride) set('status', statusOverride);

      const action =
        previousStatus !== newStatus
          ? (newStatus === 'archived' ? 'archived' : 'published')
          : 'updated';
      await logActivity(supabase, {
        clientId,
        actorId: user.id,
        action,
        entityType: 'property',
        entityId: id,
        summary: `${ACTIVITY_LABELS[action]} "${payload.name}"`,
      });

      setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000);
    }
  }

  if (loading) {
    return (
      <>
        <Topbar title="Edit Property" subtitle="Loading..." />
        <div className="page-body" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300 }}>
          <Loader2 size={24} color="var(--ne-blue)" style={{ animation: 'spin .6s linear infinite' }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </>
    );
  }

  const cardStyle: React.CSSProperties = {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 'var(--r-md)', padding: '18px 20px',
  };
  const sectionTitle: React.CSSProperties = {
    fontSize: 12, fontWeight: 700, color: 'var(--fg2)', marginBottom: 14,
    textTransform: 'uppercase', letterSpacing: '.06em',
  };

  return (
    <>
      <Topbar
        title={isNew ? 'New Property' : 'Edit Property'}
        subtitle={isNew ? 'Add a new listing' : form.name || '(Untitled)'}
      />
      <div className="page-body">
        {/* Breadcrumb + actions */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <Link href="/cms/properties" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--fg3)', textDecoration: 'none', fontWeight: 500 }}>
            <ArrowLeft size={14} /> Back to Properties
          </Link>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {isAdmin && isNew && !clientId && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ne-danger)', padding: '8px 14px', background: '#FEF2F2', borderRadius: 'var(--r-sm)' }}>Select a client in the sidebar first.</div>}
            {error && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ne-danger)', padding: '8px 14px', background: '#FEF2F2', borderRadius: 'var(--r-sm)' }}>{error}</div>}
            {saved  && <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ne-success)', padding: '8px 14px', background: '#DCFCE7', borderRadius: 'var(--r-sm)' }}>Saved</div>}
            <button className="btn-outline-ne" onClick={() => handleSave('archived')} disabled={saving}>
              {saving ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Save size={14} />}
              Archive
            </button>
            <button className="btn-ne" onClick={() => handleSave('active')} disabled={saving}>
              {saving ? <Loader2 size={14} style={{ animation: 'spin .6s linear infinite' }} /> : <Send size={14} />}
              {form.status === 'active' ? 'Update' : 'Publish'}
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>
          {/* Main column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

            {/* Name + slug */}
            <div style={cardStyle}>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value, slug: slugify(e.target.value) }))}
                placeholder="Property name..."
                style={{ width: '100%', padding: '14px 16px', border: 'none', outline: 'none', fontSize: 20, fontWeight: 700, color: 'var(--fg1)', background: 'transparent' }}
              />
              <div style={{ padding: '0 16px 12px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--fg3)', borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
                <span>Slug:</span>
                <input value={form.slug} onChange={(e) => set('slug', e.target.value)}
                  style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 12, color: 'var(--ne-blue)', fontFamily: 'monospace' }} />
              </div>
            </div>

            {/* Location */}
            <div style={cardStyle}>
              <div style={sectionTitle}>Location</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="Address">
                  <input value={form.address} onChange={(e) => set('address', e.target.value)} style={inputStyle} placeholder="63 Cavenagh Road" />
                </Field>
                <Field label="Area">
                  <input value={form.area} onChange={(e) => set('area', e.target.value)} style={inputStyle} placeholder="Cairnhill · Orchard fringe" />
                </Field>
                <Field label="District">
                  <input value={form.district} onChange={(e) => set('district', e.target.value)} style={inputStyle} placeholder="District 9" />
                </Field>
                <Field label="Tagline">
                  <input value={form.tagline} onChange={(e) => set('tagline', e.target.value)} style={inputStyle} placeholder="One-line positioning" />
                </Field>
              </div>
            </div>

            {/* Specs */}
            <div style={cardStyle}>
              <div style={sectionTitle}>Specifications</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                <Field label="Property Type">
                  <input value={form.property_type} onChange={(e) => set('property_type', e.target.value)} style={inputStyle} placeholder="Condominium · 2 bedroom" />
                </Field>
                <Field label="Tenure">
                  <input value={form.tenure} onChange={(e) => set('tenure', e.target.value)} style={inputStyle} placeholder="Freehold" />
                </Field>
                <Field label="Furnishing">
                  <input value={form.furnishing} onChange={(e) => set('furnishing', e.target.value)} style={inputStyle} placeholder="Fully / Partially / Unfurnished" />
                </Field>
                <Field label="Bedrooms">
                  <input type="number" value={form.bedrooms} onChange={(e) => set('bedrooms', e.target.value)} style={inputStyle} min={0} />
                </Field>
                <Field label="Bathrooms">
                  <input type="number" value={form.bathrooms} onChange={(e) => set('bathrooms', e.target.value)} style={inputStyle} min={0} />
                </Field>
                <Field label="Completion Year">
                  <input type="number" value={form.completion_year} onChange={(e) => set('completion_year', e.target.value)} style={inputStyle} placeholder="2015" />
                </Field>
                <Field label="Price (SGD)">
                  <input type="number" value={form.price} onChange={(e) => set('price', e.target.value)} style={inputStyle} placeholder="2180000" />
                </Field>
                <Field label="PSF (SGD)">
                  <input type="number" value={form.psf} onChange={(e) => set('psf', e.target.value)} style={inputStyle} placeholder="2178" />
                </Field>
                <Field label="Size (sqft)">
                  <input type="number" value={form.size_sqft} onChange={(e) => set('size_sqft', e.target.value)} style={inputStyle} placeholder="1001" />
                </Field>
              </div>
            </div>

            {/* Description */}
            <div style={cardStyle}>
              <div style={sectionTitle}>Description</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Field label="Story (main narrative)">
                  <textarea value={form.story} onChange={(e) => set('story', e.target.value)} rows={5}
                    style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
                    placeholder="Describe the property in detail..." />
                </Field>
                <Field label="Location Note (public factual context)">
                  <textarea value={form.location_note} onChange={(e) => set('location_note', e.target.value)} rows={3}
                    style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6 }}
                    placeholder="Context about the location..." />
                </Field>
                <Field label="Availability">
                  <input value={form.available} onChange={(e) => set('available', e.target.value)} style={inputStyle} placeholder="e.g. Q3 2026 or Immediate" />
                </Field>
              </div>
            </div>

            {/* Highlights */}
            <div style={cardStyle}>
              <div style={sectionTitle}>Highlights</div>
              {form.highlights.map((h, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '140px 1fr', gap: 8 }}>
                    <input value={h.label} onChange={(e) => {
                      const hl = [...form.highlights]; hl[i] = { ...hl[i], label: e.target.value };
                      set('highlights', hl);
                    }} style={inputStyle} placeholder="Label" />
                    <input value={h.body} onChange={(e) => {
                      const hl = [...form.highlights]; hl[i] = { ...hl[i], body: e.target.value };
                      set('highlights', hl);
                    }} style={inputStyle} placeholder="Description" />
                  </div>
                  <button onClick={() => set('highlights', form.highlights.filter((_, j) => j !== i))}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: '8px 4px' }}>
                    <X size={14} />
                  </button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <input value={newHlLabel} onChange={(e) => setNewHlLabel(e.target.value)} style={{ ...inputStyle, flex: '0 0 140px' }} placeholder="Label" />
                <input value={newHlBody} onChange={(e) => setNewHlBody(e.target.value)} style={{ ...inputStyle, flex: 1 }} placeholder="Description"
                  onKeyDown={(e) => { if (e.key === 'Enter' && newHlLabel.trim()) { set('highlights', [...form.highlights, { label: newHlLabel.trim(), body: newHlBody.trim() }]); setNewHlLabel(''); setNewHlBody(''); }}} />
                <button onClick={() => { if (!newHlLabel.trim()) return; set('highlights', [...form.highlights, { label: newHlLabel.trim(), body: newHlBody.trim() }]); setNewHlLabel(''); setNewHlBody(''); }}
                  style={{ background: 'var(--ne-blue)', border: 'none', borderRadius: 'var(--r-sm)', padding: '7px 10px', cursor: 'pointer', color: '#fff' }}>
                  <Plus size={14} />
                </button>
              </div>
            </div>

            {/* Connectivity + Amenities */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* Connectivity */}
              <div style={cardStyle}>
                <div style={sectionTitle}>Connectivity</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {form.connectivity.map((c, i) => (
                    <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 500, background: 'var(--surface-3)', color: 'var(--fg2)', padding: '3px 8px', borderRadius: 99 }}>
                      {c}
                      <button onClick={() => set('connectivity', form.connectivity.filter((_, j) => j !== i))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 0, display: 'flex' }}><X size={10} /></button>
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={newConnectivity} onChange={(e) => setNewConnectivity(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && newConnectivity.trim()) { set('connectivity', [...form.connectivity, newConnectivity.trim()]); setNewConnectivity(''); }}}
                    style={{ ...inputStyle, flex: 1 }} placeholder="e.g. 5 min Orchard MRT" />
                  <button onClick={() => { if (!newConnectivity.trim()) return; set('connectivity', [...form.connectivity, newConnectivity.trim()]); setNewConnectivity(''); }}
                    style={{ background: 'var(--ne-blue)', border: 'none', borderRadius: 'var(--r-sm)', padding: '7px 10px', cursor: 'pointer', color: '#fff' }}>
                    <Plus size={14} />
                  </button>
                </div>
              </div>

              {/* Amenities */}
              <div style={cardStyle}>
                <div style={sectionTitle}>Amenities</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {form.amenities.map((a, i) => (
                    <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 500, background: 'var(--surface-3)', color: 'var(--fg2)', padding: '3px 8px', borderRadius: 99 }}>
                      {a}
                      <button onClick={() => set('amenities', form.amenities.filter((_, j) => j !== i))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 0, display: 'flex' }}><X size={10} /></button>
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={newAmenity} onChange={(e) => setNewAmenity(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && newAmenity.trim()) { set('amenities', [...form.amenities, newAmenity.trim()]); setNewAmenity(''); }}}
                    style={{ ...inputStyle, flex: 1 }} placeholder="e.g. Swimming pool" />
                  <button onClick={() => { if (!newAmenity.trim()) return; set('amenities', [...form.amenities, newAmenity.trim()]); setNewAmenity(''); }}
                    style={{ background: 'var(--ne-blue)', border: 'none', borderRadius: 'var(--r-sm)', padding: '7px 10px', cursor: 'pointer', color: '#fff' }}>
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            </div>

            {/* Media */}
            <div style={cardStyle}>
              <div style={sectionTitle}>Media</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg3)', marginBottom: 5 }}>Hero Image</div>
                  {form.hero_url ? (
                    <div style={{ position: 'relative', marginBottom: 12 }}>
                      <img src={form.hero_url} alt={form.hero_alt} style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 'var(--r-sm)', display: 'block' }} />
                      <button onClick={() => setPickerMode('hero')}
                        style={{ position: 'absolute', bottom: 8, left: 8, background: 'rgba(0,0,0,.6)', border: 'none', borderRadius: 'var(--r-sm)', padding: '5px 12px', cursor: 'pointer', color: '#fff', fontSize: 11.5, fontWeight: 600 }}>
                        Change
                      </button>
                      <button onClick={() => { set('hero_url', ''); set('hero_alt', ''); }}
                        style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,.6)', border: 'none', borderRadius: '50%', width: 24, height: 24, cursor: 'pointer', color: '#fff', display: 'grid', placeItems: 'center' }}>
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setPickerMode('hero')}
                      style={{ width: '100%', border: '2px dashed var(--border)', borderRadius: 'var(--r-sm)', padding: '24px 16px', textAlign: 'center', cursor: 'pointer', background: 'transparent', marginBottom: 12 }}>
                      <ImageIcon size={20} color="var(--fg3)" style={{ margin: '0 auto 6px' }} />
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg2)' }}>Choose Hero Image</div>
                      <div style={{ fontSize: 11, color: 'var(--fg3)' }}>From the media library</div>
                    </button>
                  )}
                  <Field label="Hero Alt Text">
                    <input value={form.hero_alt} onChange={(e) => set('hero_alt', e.target.value)} style={inputStyle} placeholder="Living room view" />
                  </Field>
                </div>

                {/* Gallery */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg3)' }}>Gallery</div>
                    <button type="button" onClick={() => setPickerMode('gallery')}
                      style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: 'var(--ne-blue)', background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '5px 10px', cursor: 'pointer' }}>
                      <ImageIcon size={12} /> Add from Library
                    </button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                    {form.gallery.map((g, i) => (
                      <div key={i} style={{ position: 'relative', width: 80, height: 80 }}>
                        <img src={g.src} alt={g.alt} style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 'var(--r-sm)', display: 'block' }} />
                        <button onClick={() => set('gallery', form.gallery.filter((_, j) => j !== i))}
                          style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(0,0,0,.65)', border: 'none', borderRadius: '50%', width: 18, height: 18, cursor: 'pointer', color: '#fff', display: 'grid', placeItems: 'center' }}>
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                    {form.gallery.length === 0 && (
                      <div style={{ width: 80, height: 80, border: '2px dashed var(--border)', borderRadius: 'var(--r-sm)', display: 'grid', placeItems: 'center' }}>
                        <ImageIcon size={20} color="var(--fg3)" />
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input value={newGalSrc} onChange={(e) => setNewGalSrc(e.target.value)} style={{ ...inputStyle, flex: 1 }} placeholder="Image URL" />
                    <input value={newGalAlt} onChange={(e) => setNewGalAlt(e.target.value)} style={{ ...inputStyle, flex: '0 0 160px' }} placeholder="Alt text" />
                    <button onClick={() => { if (!newGalSrc.trim()) return; set('gallery', [...form.gallery, { src: newGalSrc.trim(), alt: newGalAlt.trim() }]); setNewGalSrc(''); setNewGalAlt(''); }}
                      style={{ background: 'var(--ne-blue)', border: 'none', borderRadius: 'var(--r-sm)', padding: '7px 10px', cursor: 'pointer', color: '#fff' }}>
                      <Plus size={14} />
                    </button>
                  </div>
                </div>

                <Field label="Source URL (PropNex listing link)">
                  <input value={form.source_url} onChange={(e) => set('source_url', e.target.value)} style={inputStyle} placeholder="https://www.propnex.com/..." />
                </Field>
              </div>
            </div>

            {/* SEO */}
            <div style={cardStyle}>
              <div style={sectionTitle}>SEO Settings</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Field label="SEO Title">
                  <input value={form.seo_title || form.name} onChange={(e) => set('seo_title', e.target.value)} style={inputStyle} />
                </Field>
                <Field label="Meta Description">
                  <textarea value={form.seo_description || form.tagline} onChange={(e) => set('seo_description', e.target.value)} rows={2}
                    style={{ ...inputStyle, resize: 'none', fontFamily: 'inherit' }} />
                  <div style={{ fontSize: 11, color: form.seo_description.length > 160 ? 'var(--ne-danger)' : 'var(--fg3)', marginTop: 4 }}>
                    {form.seo_description.length}/160 chars
                  </div>
                </Field>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Publish */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 13 }}>Listing Settings</div>
              <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <Field label="Status">
                  <select value={form.status} onChange={(e) => set('status', e.target.value as 'active' | 'archived')}
                    style={{ ...inputStyle, cursor: 'pointer' }}>
                    <option value="active">Active</option>
                    <option value="archived">Archived</option>
                  </select>
                </Field>
                <Field label="Listing Type">
                  <select value={form.listing} onChange={(e) => set('listing', e.target.value as 'sale' | 'rent')}
                    style={{ ...inputStyle, cursor: 'pointer' }}>
                    <option value="sale">For Sale</option>
                    <option value="rent">For Rent</option>
                  </select>
                </Field>
                <Field label="Segment">
                  <select value={form.segment} onChange={(e) => set('segment', e.target.value as 'Prime' | 'City fringe' | 'Suburban')}
                    style={{ ...inputStyle, cursor: 'pointer' }}>
                    <option value="Prime">Prime</option>
                    <option value="City fringe">City fringe</option>
                    <option value="Suburban">Suburban</option>
                  </select>
                </Field>
                <button className="btn-ne" style={{ width: '100%', justifyContent: 'center' }} onClick={() => handleSave('active')} disabled={saving}>
                  <Send size={14} /> {form.status === 'active' ? 'Update Listing' : 'Publish Listing'}
                </button>
                <button className="btn-outline-ne" style={{ width: '100%', justifyContent: 'center', fontSize: 13 }} onClick={() => handleSave('archived')} disabled={saving}>
                  <Save size={14} /> Archive
                </button>
              </div>
            </div>

            {/* Hero preview */}
            {form.hero_url && (
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 13 }}>Hero Preview</div>
                <img src={form.hero_url} alt={form.hero_alt} style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block' }} />
              </div>
            )}

            {/* Quick stats */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '14px 16px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg2)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '.06em' }}>Summary</div>
              {[
                { label: 'Highlights',   value: form.highlights.length },
                { label: 'Gallery',      value: form.gallery.length },
                { label: 'Connectivity', value: form.connectivity.length },
                { label: 'Amenities',    value: form.amenities.length },
              ].map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--fg2)', marginBottom: 6 }}>
                  <span>{label}</span>
                  <span style={{ fontWeight: 700, color: value > 0 ? 'var(--ne-blue)' : 'var(--fg3)' }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <MediaPicker
        open={pickerMode !== null}
        onOpenChange={(o) => { if (!o) setPickerMode(null); }}
        accept="image"
        onSelect={(item: MediaItem) => {
          if (pickerMode === 'hero') {
            set('hero_url', item.url);
            if (!form.hero_alt && item.alt) set('hero_alt', item.alt);
          } else if (pickerMode === 'gallery') {
            set('gallery', [...form.gallery, { src: item.url, alt: item.alt ?? '' }]);
          }
        }}
      />

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
