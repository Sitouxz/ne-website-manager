'use client';

import Topbar from '@/components/Topbar';
import Link from 'next/link';
import { useState } from 'react';
import {
  ArrowLeft, Bold, Italic, Underline, Link2, List, ListOrdered,
  Quote, Image, Code, Heading2, Heading3, Eye, Save, Send, ChevronDown, X, Plus,
} from 'lucide-react';

const CATEGORIES = ['Character', 'Worship', 'Dakwah', 'Tafsir', 'Community', 'Events', 'Announcement'];

export default function PostEditor({ params }: { params: { id: string } }) {
  const isNew = params.id === 'new';

  const [form, setForm] = useState({
    title: isNew ? '' : 'Sifat Sombong Pemusnah Segalanya',
    slug: isNew ? '' : 'sifat-sombong-pemusnah-segalanya',
    excerpt: isNew ? '' : 'Sombong adalah sifat yang amat dibenci oleh Allah SWT.',
    content: isNew ? '' : `<h2>Mukadimah</h2><p>Sifat sombong adalah salah satu penyakit hati yang paling berbahaya dalam Islam. Allah SWT telah memperingatkan umat manusia tentang bahaya sifat ini berkali-kali dalam al-Quran.</p><p>Rasulullah SAW bersabda: "Tidak akan masuk syurga orang yang di dalam hatinya terdapat kesombongan sebesar biji sawi." (HR Muslim)</p><h2>Tanda-tanda Sifat Sombong</h2><p>Seseorang yang memiliki sifat sombong biasanya menunjukkan beberapa tanda yang jelas...</p>`,
    category: isNew ? 'Worship' : 'Character',
    status: isNew ? 'draft' : 'published',
    featuredImg: '',
    tags: isNew ? [] as string[] : ['character', 'tarbiyah'],
    seoTitle: '',
    seoDesc: '',
  });
  const [tagInput, setTagInput] = useState('');
  const [activeFormats, setActiveFormats] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  const toggleFormat = (f: string) =>
    setActiveFormats((prev) => prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]);

  const handleSave = (newStatus?: string) => {
    if (newStatus) setForm((f) => ({ ...f, status: newStatus }));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !form.tags.includes(t)) setForm((f) => ({ ...f, tags: [...f.tags, t] }));
    setTagInput('');
  };

  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  return (
    <>
      <Topbar
        title={isNew ? 'New Post' : 'Edit Post'}
        subtitle={isNew ? 'Create a new blog post' : form.title}
      />
      <div className="page-body">
        {/* Breadcrumb + actions */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <Link href="/cms/posts" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--fg3)', textDecoration: 'none', fontWeight: 500 }}>
            <ArrowLeft size={14} /> Back to Posts
          </Link>
          <div style={{ display: 'flex', gap: 8 }}>
            {saved && (
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ne-success)', padding: '8px 14px', background: '#E8F8F1', borderRadius: 'var(--r-sm)' }}>
                ✓ Saved
              </div>
            )}
            <button className="btn-outline-ne" onClick={() => handleSave('draft')}>
              <Save size={14} /> Save Draft
            </button>
            <button className="btn-ne" onClick={() => handleSave('published')}>
              <Send size={14} /> {form.status === 'published' ? 'Update' : 'Publish'}
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 20, alignItems: 'start' }}>
          {/* Main editor */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Title */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value, slug: slugify(e.target.value) })}
                placeholder="Post title..."
                style={{ width: '100%', padding: '18px 20px', border: 'none', outline: 'none', fontSize: 22, fontWeight: 700, color: 'var(--fg1)', background: 'transparent' }}
              />
              <div style={{ padding: '0 20px 14px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--fg3)' }}>
                <span>Slug:</span>
                <input
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value })}
                  style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 12, color: 'var(--ne-accent)', fontFamily: 'monospace' }}
                />
              </div>
            </div>

            {/* Rich text editor */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
              {/* Toolbar */}
              <div className="editor-toolbar">
                {[
                  { id: 'h2', label: 'H2', Icon: Heading2 },
                  { id: 'h3', label: 'H3', Icon: Heading3 },
                ].map(({ id, Icon }) => (
                  <button key={id} className={`toolbar-btn${activeFormats.includes(id) ? ' active' : ''}`} onClick={() => toggleFormat(id)}>
                    <Icon size={15} />
                  </button>
                ))}
                <div className="toolbar-sep" />
                {[
                  { id: 'bold', Icon: Bold },
                  { id: 'italic', Icon: Italic },
                  { id: 'underline', Icon: Underline },
                ].map(({ id, Icon }) => (
                  <button key={id} className={`toolbar-btn${activeFormats.includes(id) ? ' active' : ''}`} onClick={() => toggleFormat(id)}>
                    <Icon size={15} />
                  </button>
                ))}
                <div className="toolbar-sep" />
                {[
                  { id: 'ul', Icon: List },
                  { id: 'ol', Icon: ListOrdered },
                  { id: 'quote', Icon: Quote },
                  { id: 'code', Icon: Code },
                ].map(({ id, Icon }) => (
                  <button key={id} className={`toolbar-btn${activeFormats.includes(id) ? ' active' : ''}`} onClick={() => toggleFormat(id)}>
                    <Icon size={15} />
                  </button>
                ))}
                <div className="toolbar-sep" />
                <button className="toolbar-btn"><Link2 size={15} /></button>
                <button className="toolbar-btn"><Image size={15} /></button>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  <button className="toolbar-btn" style={{ fontSize: 11, fontWeight: 700, color: 'var(--fg3)' }}>
                    <Eye size={14} /> Preview
                  </button>
                </div>
              </div>

              {/* Content area */}
              <div
                contentEditable
                suppressContentEditableWarning
                dangerouslySetInnerHTML={{ __html: form.content }}
                onInput={(e) => setForm({ ...form, content: (e.target as HTMLDivElement).innerHTML })}
                style={{
                  minHeight: 420, padding: '20px 24px', outline: 'none',
                  fontSize: 14.5, lineHeight: 1.75, color: 'var(--fg1)',
                  fontFamily: 'Inter, sans-serif',
                }}
              />
            </div>

            {/* Excerpt */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '18px 20px' }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--fg2)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.06em' }}>Excerpt</label>
              <textarea
                value={form.excerpt}
                onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
                placeholder="Short description shown in post listings..."
                rows={3}
                style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '10px 12px', fontSize: 13.5, color: 'var(--fg1)', resize: 'vertical', outline: 'none', fontFamily: 'inherit' }}
              />
            </div>

            {/* SEO */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', padding: '18px 20px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--fg2)', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '.06em' }}>SEO Settings</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg3)', display: 'block', marginBottom: 5 }}>SEO Title</label>
                  <input
                    value={form.seoTitle || form.title}
                    onChange={(e) => setForm({ ...form, seoTitle: e.target.value })}
                    style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '9px 12px', fontSize: 13.5, color: 'var(--fg1)', outline: 'none' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--fg3)', display: 'block', marginBottom: 5 }}>Meta Description</label>
                  <textarea
                    value={form.seoDesc || form.excerpt}
                    onChange={(e) => setForm({ ...form, seoDesc: e.target.value })}
                    rows={2}
                    style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '9px 12px', fontSize: 13.5, color: 'var(--fg1)', resize: 'none', outline: 'none', fontFamily: 'inherit' }}
                  />
                  <div style={{ fontSize: 11, color: form.seoDesc.length > 160 ? 'var(--ne-danger)' : 'var(--fg3)', marginTop: 4 }}>
                    {form.seoDesc.length}/160 chars
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Publish box */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 13 }}>Publish Settings</div>
              <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div>
                  <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--fg3)', display: 'block', marginBottom: 5 }}>Status</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm({ ...form, status: e.target.value })}
                    style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '8px 10px', fontSize: 13, color: 'var(--fg1)', background: 'var(--surface)' }}
                  >
                    <option value="draft">Draft</option>
                    <option value="published">Published</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--fg3)', display: 'block', marginBottom: 5 }}>Category</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '8px 10px', fontSize: 13, color: 'var(--fg1)', background: 'var(--surface)' }}
                  >
                    {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <button className="btn-ne" style={{ width: '100%', justifyContent: 'center' }} onClick={() => handleSave('published')}>
                  <Send size={14} /> {form.status === 'published' ? 'Update Post' : 'Publish Post'}
                </button>
                <button className="btn-outline-ne" style={{ width: '100%', justifyContent: 'center', fontSize: 13 }} onClick={() => handleSave('draft')}>
                  <Save size={14} /> Save as Draft
                </button>
              </div>
            </div>

            {/* Featured image */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 13 }}>Featured Image</div>
              <div style={{ padding: '14px 16px' }}>
                {form.featuredImg ? (
                  <div style={{ position: 'relative' }}>
                    <img src={form.featuredImg} alt="" style={{ width: '100%', borderRadius: 'var(--r-sm)', objectFit: 'cover', height: 140 }} />
                    <button onClick={() => setForm({ ...form, featuredImg: '' })}
                      style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,.6)', border: 'none', borderRadius: '50%', width: 22, height: 22, cursor: 'pointer', color: '#fff', display: 'grid', placeItems: 'center' }}>
                      <X size={11} />
                    </button>
                  </div>
                ) : (
                  <div style={{
                    border: '2px dashed var(--border)', borderRadius: 'var(--r-sm)',
                    padding: '28px 16px', textAlign: 'center', cursor: 'pointer',
                  }}>
                    <Image size={22} color="var(--fg3)" style={{ margin: '0 auto 8px' }} />
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--fg2)', marginBottom: 4 }}>Add Featured Image</div>
                    <div style={{ fontSize: 11, color: 'var(--fg3)' }}>Click to upload or drag & drop</div>
                    <div style={{ fontSize: 10, color: 'var(--fg3)', marginTop: 4 }}>PNG, JPG up to 5MB</div>
                  </div>
                )}
              </div>
            </div>

            {/* Tags */}
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-md)', overflow: 'hidden' }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 13 }}>Tags</div>
              <div style={{ padding: '14px 16px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {form.tags.map((t) => (
                    <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, fontWeight: 600, background: 'var(--surface-3)', color: 'var(--fg2)', padding: '3px 8px', borderRadius: 99 }}>
                      {t}
                      <button onClick={() => setForm((f) => ({ ...f, tags: f.tags.filter((x) => x !== t) }))}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 0, display: 'flex' }}>
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
                    placeholder="Add tag..."
                    style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 'var(--r-sm)', padding: '7px 10px', fontSize: 12.5, outline: 'none' }}
                  />
                  <button onClick={addTag} style={{ background: 'var(--ne-ink)', border: 'none', borderRadius: 'var(--r-sm)', padding: '7px 10px', cursor: 'pointer', color: '#fff' }}>
                    <Plus size={14} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
