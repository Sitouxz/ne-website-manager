'use client';

import Topbar from '@/components/Topbar';
import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft, Loader2, Download, Check, Archive, Trash2, ChevronDown, ChevronUp, ShieldAlert, Circle,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import { useConfirm } from '@/components/ConfirmDialog';
import { errorMessage } from '@/lib/errors';
import type { Form, FormSubmission, FormSubmissionStatus } from '@/lib/supabase/types';
import { BulkActionBar } from '@/components/builder/BulkActionBar';
import { useBulkSelection } from '@/lib/hooks/useBulkSelection';

type StatusFilter = 'all' | FormSubmissionStatus;

const STATUS_BADGE: Record<FormSubmissionStatus, { label: string; bg: string; fg: string }> = {
  new:      { label: 'New',      bg: '#DBEAFE', fg: '#1D4ED8' },
  read:     { label: 'Read',     bg: 'var(--surface-3)', fg: 'var(--fg2)' },
  archived: { label: 'Archived', bg: 'var(--surface-3)', fg: 'var(--fg3)' },
  spam:     { label: 'Spam',     bg: '#FEF2F2', fg: 'var(--ne-danger)' },
};

/**
 * CSV cell escaping: wraps in quotes and doubles any embedded quote whenever
 * the value contains a comma, quote, or newline — the minimal RFC 4180 rule
 * needed here. Arrays/objects (e.g. a `multiselect` field's value) are
 * JSON-stringified first so they still round-trip as a single CSV cell
 * rather than corrupting column alignment.
 */
function csvCell(value: unknown): string {
  let s: string;
  if (value === undefined || value === null) s = '';
  else if (typeof value === 'string') s = value;
  else if (typeof value === 'object') s = JSON.stringify(value);
  else s = String(value);

  if (/[",\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Builds a CSV string from `submissions`, using `fields` (the form's
 * `FieldDef[]`) to determine column order/headers for the `data` portion,
 * plus trailing `status`/`created_at` columns. Client-side generation only —
 * no CSV library dependency, per the brief.
 */
function buildCsv(form: Form, submissions: FormSubmission[]): string {
  const fieldKeys = form.fields.map((f) => f.key);
  const headers = [...form.fields.map((f) => f.label || f.key), 'Status', 'Submitted At'];
  const lines = [headers.map(csvCell).join(',')];

  for (const sub of submissions) {
    const row = [
      ...fieldKeys.map((key) => csvCell(sub.data?.[key])),
      csvCell(sub.status),
      csvCell(sub.created_at),
    ];
    lines.push(row.join(','));
  }

  return lines.join('\r\n');
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function FormSubmissionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [form,        setForm]        = useState<Form | null>(null);
  const [submissions,  setSubmissions] = useState<FormSubmission[]>([]);
  const [loading,      setLoading]     = useState(true);
  const [filter,       setFilter]      = useState<StatusFilter>('all');
  const confirm = useConfirm();
  const [expandedId,   setExpandedId]  = useState<string | null>(null);
  const [error,        setError]       = useState('');
  const [bulkBusy,     setBulkBusy]    = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const [{ data: formRow }, { data: subRows }] = await Promise.all([
      supabase.from('forms').select('*').eq('id', id).single(),
      supabase.from('form_submissions').select('*').eq('form_id', id).order('created_at', { ascending: false }),
    ]);
    setForm((formRow ?? null) as Form | null);
    setSubmissions((subRows ?? []) as FormSubmission[]);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    const timer = window.setTimeout(() => load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function updateStatus(sub: FormSubmission, status: FormSubmissionStatus) {
    const supabase = createClient();
    const { error: err } = await supabase.from('form_submissions').update({ status }).eq('id', sub.id);
    if (err) { setError(errorMessage(err, { entity: 'enquiry' })); return; }
    setSubmissions((prev) => prev.map((s) => (s.id === sub.id ? { ...s, status } : s)));
  }

  async function handleDelete(sub: FormSubmission) {
    const ok = await confirm({
      title: 'Delete this enquiry?',
      body: 'This permanently removes it. It cannot be undone.',
      consequences: [
        "You will lose this person's message and their contact details.",
        'If you only want it out of your way, mark it as archived instead.',
      ],
      confirmLabel: 'Delete enquiry',
    });
    if (!ok) return;

    const supabase = createClient();
    const { error: err } = await supabase.from('form_submissions').delete().eq('id', sub.id);
    if (err) { setError(errorMessage(err, { entity: 'enquiry', action: 'delete' })); return; }
    setSubmissions((prev) => prev.filter((s) => s.id !== sub.id));
    toast.success('Enquiry deleted.');
  }

  /**
   * Exports whatever the active filter is showing.
   *
   * The filename records the filter and the date, because it is the only
   * thing that survives into the user's Downloads folder. A "New only" export
   * and a full export were previously the same filename, so a spreadsheet
   * opened a week later gave no way to tell whether it was every enquiry or a
   * slice of them — and the safest wrong assumption there is the damaging one.
   */
  function handleExport() {
    if (!form) return;
    const rows = filter === 'all' ? submissions : submissions.filter((s) => s.status === filter);
    const csv = buildCsv(form, rows);
    const scope = filter === 'all' ? 'all' : filter;
    const today = new Date().toISOString().slice(0, 10);
    downloadCsv(`${form.slug}-submissions-${scope}-${today}.csv`, csv);
  }

  const filtered = filter === 'all' ? submissions : submissions.filter((s) => s.status === filter);
  const selection = useBulkSelection(filtered.map((s) => s.id));

  /**
   * Marks every selected enquiry at once.
   *
   * Archiving in bulk is the point of this: an inbox of eighty enquiries is
   * cleared by triaging, and doing that one dropdown at a time is why people
   * stop triaging. Deleting stays a separate, confirmed action — an enquiry
   * holds somebody's message and contact details, and there is no undo.
   */
  async function bulkSetStatus(status: FormSubmissionStatus) {
    const chosen = submissions.filter((s) => selection.selectedVisibleIds.includes(s.id));
    if (chosen.length === 0) return;

    setBulkBusy(true);
    setError('');
    const supabase = createClient();
    const results = await Promise.all(chosen.map((sub) => supabase
      .from('form_submissions')
      .update({ status })
      .eq('id', sub.id)));

    const succeeded = chosen.filter((_, i) => !results[i].error);
    const failed = chosen.length - succeeded.length;

    setSubmissions((prev) => prev.map((s) => (
      succeeded.some((x) => x.id === s.id) ? { ...s, status } : s
    )));
    selection.clear();
    setBulkBusy(false);

    if (failed > 0) toast.warning(`${succeeded.length} updated, ${failed} could not be updated.`);
    else toast.success(`${succeeded.length} ${succeeded.length === 1 ? 'enquiry' : 'enquiries'} marked as ${status}.`);
  }

  async function bulkDelete() {
    const chosen = submissions.filter((s) => selection.selectedVisibleIds.includes(s.id));
    if (chosen.length === 0) return;

    const ok = await confirm({
      title: `Delete ${chosen.length} ${chosen.length === 1 ? 'enquiry' : 'enquiries'}?`,
      body: 'This permanently removes them. It cannot be undone.',
      consequences: [
        `You will lose ${chosen.length === 1 ? "this person's message and their contact details" : "these people's messages and their contact details"}.`,
        'If you only want them out of your way, mark them as archived instead.',
      ],
      confirmLabel: `Delete ${chosen.length === 1 ? 'enquiry' : 'enquiries'}`,
    });
    if (!ok) return;

    setBulkBusy(true);
    setError('');
    const supabase = createClient();
    const results = await Promise.all(chosen.map((sub) => supabase.from('form_submissions').delete().eq('id', sub.id)));
    const deleted = chosen.filter((_, i) => !results[i].error);
    const failed = chosen.length - deleted.length;

    setSubmissions((prev) => prev.filter((s) => !deleted.some((d) => d.id === s.id)));
    selection.clear();
    setBulkBusy(false);

    if (failed > 0) toast.warning(`${deleted.length} deleted, ${failed} could not be deleted.`);
    else toast.success(`${deleted.length} ${deleted.length === 1 ? 'enquiry' : 'enquiries'} deleted.`);
  }

  const counts: Record<StatusFilter, number> = {
    all: submissions.length,
    new: submissions.filter((s) => s.status === 'new').length,
    read: submissions.filter((s) => s.status === 'read').length,
    archived: submissions.filter((s) => s.status === 'archived').length,
    spam: submissions.filter((s) => s.status === 'spam').length,
  };

  if (loading) {
    return (
      <>
        <Topbar title="Submissions" />
        <div className="page-body" style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
          <Loader2 size={24} color="var(--ne-blue)" className="spin" />
        </div>
        </>
    );
  }

  if (!form) {
    return (
      <>
        <Topbar title="Submissions" />
        <div className="page-body">
          <div style={{ padding: '64px 24px', textAlign: 'center', color: 'var(--fg3)' }}>
            Form not found.
            <div style={{ marginTop: 16 }}>
              <Link href="/forms" className="btn-outline-ne"><ArrowLeft size={14} /> Back to Forms</Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar title={form.name} subtitle={`Submissions · /${form.slug}`} />
      <div className="page-body">
        <Link href="/forms" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--fg3)', textDecoration: 'none', fontWeight: 500, marginBottom: 20, width: 'fit-content' }}>
          <ArrowLeft size={14} /> Back to Forms
        </Link>

        {error && (
          <div style={{ padding: '10px 14px', background: '#FEF2F2', color: 'var(--ne-danger)', borderRadius: 'var(--r-sm)', fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {([
              ['all', 'All'],
              ['new', 'New'],
              ['read', 'Read'],
              ['archived', 'Archived'],
              ['spam', 'Spam'],
            ] as [StatusFilter, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={filter === key ? 'btn-ne' : 'btn-outline-ne'}
                style={{ fontSize: 12, padding: '6px 12px' }}
              >
                {label} ({counts[key]})
              </button>
            ))}
          </div>
          <button className="btn-outline-ne" onClick={handleExport} disabled={filtered.length === 0}>
            <Download size={14} /> Export CSV
          </button>
        </div>

        <BulkActionBar
          count={selection.count}
          busy={bulkBusy}
          onClear={selection.clear}
          onDelete={bulkDelete}
        >
          <button className="btn-outline-ne" onClick={() => bulkSetStatus('read')} disabled={bulkBusy}>
            Mark as read
          </button>
          {/* The way back from a mis-click. Bulk actions have no undo, and
              "mark all as read" is the easiest one to fire by accident on the
              wrong selection — without this, recovering means reopening each
              enquiry's dropdown one at a time. */}
          <button className="btn-outline-ne" onClick={() => bulkSetStatus('new')} disabled={bulkBusy}>
            Mark as unread
          </button>
          <button className="btn-outline-ne" onClick={() => bulkSetStatus('archived')} disabled={bulkBusy}>
            Archive
          </button>
          {/* Spam arrives in bursts — a form that gets hit gets hit fifty
              times, and marking those one at a time is why the status exists
              and never gets used. Kept distinct from Archive: archived means
              "dealt with", spam means "was never a real enquiry", and only the
              second is safe to ignore wholesale later. */}
          <button className="btn-outline-ne" onClick={() => bulkSetStatus('spam')} disabled={bulkBusy}>
            Mark as spam
          </button>
        </BulkActionBar>

        <div className="panel">
          {filtered.length === 0 ? (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--fg3)', fontSize: 13 }}>
              No submissions{filter !== 'all' ? ` with status "${filter}"` : ''} yet.
            </div>
          ) : (
            <div>
              {filtered.map((sub, i) => {
                const badge = STATUS_BADGE[sub.status];
                const expanded = expandedId === sub.id;
                const summary = form.fields
                  .slice(0, 3)
                  .map((f) => sub.data?.[f.key])
                  .filter((v) => v !== undefined && v !== null && v !== '')
                  .map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v)))
                  .join(' · ');

                return (
                  <div key={sub.id} style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 20px' }}>
                      <input
                        type="checkbox"
                        checked={selection.isSelected(sub.id)}
                        onChange={() => selection.toggle(sub.id)}
                        aria-label="Select this enquiry"
                        style={{ width: 16, height: 16, cursor: 'pointer', flexShrink: 0 }}
                      />
                      <button
                        onClick={() => setExpandedId(expanded ? null : sub.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--fg3)', padding: 2 }}
                        aria-label={expanded ? 'Collapse' : 'Expand'}
                      >
                        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: badge.bg, color: badge.fg }}>
                            {sub.status === 'new' && <Circle size={6} fill={badge.fg} color={badge.fg} style={{ marginRight: 4, display: 'inline-block' }} />}
                            {badge.label}
                          </span>
                          <span style={{ fontSize: 12, color: 'var(--fg3)' }}>{new Date(sub.created_at).toLocaleString()}</span>
                        </div>
                        {!expanded && summary && (
                          <div style={{ fontSize: 13, color: 'var(--fg1)', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {summary}
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {sub.status !== 'read' && (
                          <button className="btn-outline-ne" style={{ fontSize: 11.5, padding: '5px 10px' }} onClick={() => updateStatus(sub, 'read')}>
                            <Check size={12} /> Mark read
                          </button>
                        )}
                        {sub.status !== 'archived' && (
                          <button className="btn-outline-ne" style={{ fontSize: 11.5, padding: '5px 10px' }} onClick={() => updateStatus(sub, 'archived')}>
                            <Archive size={12} /> Archive
                          </button>
                        )}
                        {sub.status !== 'spam' && (
                          <button className="btn-outline-ne" style={{ fontSize: 11.5, padding: '5px 10px' }} onClick={() => updateStatus(sub, 'spam')}>
                            <ShieldAlert size={12} /> Mark spam
                          </button>
                        )}
                        <button onClick={() => handleDelete(sub)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ne-danger)', padding: 6 }} aria-label="Delete submission">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    {expanded && (
                      <div style={{ padding: '0 20px 16px 48px' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <tbody>
                            {form.fields.map((f) => (
                              <tr key={f.key}>
                                <td style={{ padding: '4px 12px 4px 0', color: 'var(--fg3)', fontWeight: 600, verticalAlign: 'top', whiteSpace: 'nowrap' }}>{f.label}</td>
                                <td style={{ padding: '4px 0', color: 'var(--fg1)' }}>
                                  {(() => {
                                    const v = sub.data?.[f.key];
                                    if (v === undefined || v === null || v === '') return <span style={{ color: 'var(--fg3)' }}>—</span>;
                                    return typeof v === 'object' ? JSON.stringify(v) : String(v);
                                  })()}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
