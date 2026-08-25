'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ElementType } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Activity,
  Bell,
  BookOpen,
  Boxes,
  CircleHelp,
  ExternalLink,
  FileEdit,
  FileText,
  Image,
  LayoutDashboard,
  Mail,
  Menu,
  Navigation,
  Search,
  Settings,
  Sparkles,
} from 'lucide-react';
import { useMobileMenu, useSelectedClient } from './AppShell';
import { createClient } from '@/lib/supabase/client';
import { escapeLikePattern } from '@/lib/like-escape';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const COMMANDS = [
  { label: 'Home', description: 'Open the operating dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Blog posts', description: 'Create and manage articles', href: '/cms/posts', icon: FileText },
  { label: 'Pages', description: 'Edit website pages', href: '/cms/pages', icon: FileEdit },
  { label: 'Media', description: 'Upload and organize files', href: '/cms/media', icon: Image },
  { label: 'Collections', description: 'Manage structured content', href: '/cms/collections', icon: Boxes },
  { label: 'Website navigation', description: 'Arrange the site menu', href: '/cms/navigation', icon: Navigation },
  { label: 'Website check', description: 'See what is broken on the live website', href: '/health', icon: Activity },
  { label: 'Forms', description: 'Read enquiries and leads', href: '/forms', icon: Mail },
  { label: 'SEO', description: 'Redirects and search descriptions', href: '/seo', icon: Search },
  { label: 'Settings', description: 'Configure this website', href: '/settings', icon: Settings },
];

/**
 * Where the palette's highlight moves for a given key.
 *
 * Exported and pure so the behaviour is testable without mounting a Topbar
 * (which needs the shell's contexts, a router and Supabase) — the same shape
 * `canShowSidebarItem` uses for the sidebar's rules.
 *
 * Returns `null` for a key the palette does not handle, so the caller knows
 * not to `preventDefault` — swallowing every keystroke would break typing in
 * the search input the handler is attached to.
 */
export function nextActiveIndex(key: string, current: number, length: number): number | null {
  if (length === 0) return null;
  // Wrapping in both directions: with a list this short, holding ↓ to get
  // back to the top is faster than reaching for ↑, and a highlight that
  // sticks silently at the last row reads as broken.
  if (key === 'ArrowDown') return (current + 1) % length;
  if (key === 'ArrowUp') return (current - 1 + length) % length;
  return null;
}

export default function Topbar({ title, subtitle }: { title: string; subtitle?: string }) {
  const { onToggle } = useMobileMenu();
  const { clientName, websiteUrl, selectedClientId } = useSelectedClient();
  const router = useRouter();
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [contentResults, setContentResults] = useState<Array<{ label: string; description: string; href: string; icon: ElementType }>>([]);
  const [contentResultClientId, setContentResultClientId] = useState<string | null>(null);
  const [searchingContent, setSearchingContent] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    const normalized = query.trim();
    if (!searchOpen || normalized.length < 2 || !selectedClientId) {
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearchingContent(true);
      const supabase = createClient();
      // `escapeLikePattern` also escapes backslashes, and escapes them FIRST.
      // The inline version this replaced handled `%` and `_` but not `\`, so a
      // query like `a\%` still reached the database with a live wildcard.
      const pattern = `%${escapeLikePattern(normalized)}%`;
      // PostgREST reads `or=(...)` as a comma-separated list, so an unquoted
      // value containing a comma splits into two malformed conditions.
      // Double-quoting keeps it one value; any `"` the user typed is escaped
      // so it cannot close the quoting early.
      const orValue = `"${pattern.replace(/"/g, '\\"')}"`;
      const [posts, pages, media, collections] = await Promise.all([
        supabase.from('posts').select('id,title,status').eq('client_id', selectedClientId).ilike('title', pattern).limit(5),
        supabase.from('pages').select('id,title,path').eq('client_id', selectedClientId).ilike('title', pattern).limit(5),
        supabase.from('media').select('id,filename,alt').eq('client_id', selectedClientId).or(`filename.ilike.${orValue},alt.ilike.${orValue}`).limit(5),
        supabase.from('collections').select('id,name').eq('client_id', selectedClientId).ilike('name', pattern).limit(5),
      ]);
      if (cancelled) return;
      setContentResults([
        ...(posts.data ?? []).map((item) => ({ label: item.title || '(Untitled post)', description: `Blog post · ${item.status}`, href: `/cms/posts/${item.id}`, icon: FileText })),
        ...(pages.data ?? []).map((item) => ({ label: item.title || '(Untitled page)', description: `Page · ${item.path}`, href: `/cms/pages/${item.id}`, icon: FileEdit })),
        ...(media.data ?? []).map((item) => ({ label: item.filename || item.alt || 'Media item', description: 'Media library', href: '/cms/media', icon: Image })),
        ...(collections.data ?? []).map((item) => ({ label: item.name, description: 'Collection', href: `/cms/collections/${item.id}`, icon: Boxes })),
      ]);
      setContentResultClientId(selectedClientId);
      setSearchingContent(false);
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, searchOpen, selectedClientId]);

  const canSearchContent = query.trim().length >= 2 && Boolean(selectedClientId);
  const visibleContentResults = useMemo(
    () => (canSearchContent && contentResultClientId === selectedClientId ? contentResults : []),
    [canSearchContent, contentResultClientId, selectedClientId, contentResults],
  );

  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return COMMANDS;
    return COMMANDS.filter((command) =>
      `${command.label} ${command.description}`.toLowerCase().includes(normalized),
    );
  }, [query]);

  /**
   * The two result groups as one flat list, in the order they render.
   *
   * The palette's footer has always advertised "Navigate with ↑ ↓ · Open with
   * Enter" while nothing listened for an arrow key — a control that claims a
   * capability it does not have, which is the specific anti-pattern the audit
   * called out. Indexing across both groups (rather than per group) is what
   * makes a single ↓ walk from the last matching page into the first matching
   * command without a dead keypress in between.
   */
  const navigableResults = useMemo(
    () => [...visibleContentResults, ...filteredCommands],
    [visibleContentResults, filteredCommands],
  );

  const [activeIndex, setActiveIndex] = useState(0);

  /**
   * Any change to the query — or reopening the palette — invalidates the
   * highlight: leaving it on index 4 after a keystroke that reduced the list
   * to two means Enter opens whatever happens to be last, which is worse
   * than no keyboard support at all.
   *
   * Adjusted during render against a stored previous value rather than in an
   * effect. `useEffect(() => setActiveIndex(0))` is the obvious spelling and
   * it is a cascading render — React renders the stale highlight, then
   * immediately re-renders to correct it. This pattern resets before anything
   * is painted, and is what the lint rule is pointing at.
   */
  const resetKey = `${query}|${searchOpen}`;
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    setActiveIndex(0);
  }

  function runCommand(href: string) {
    setSearchOpen(false);
    setQuery('');
    router.push(href);
  }

  function onPaletteKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Enter') {
      const target = navigableResults[activeIndex];
      if (!target) return;
      event.preventDefault();
      runCommand(target.href);
      return;
    }

    const next = nextActiveIndex(event.key, activeIndex, navigableResults.length);
    if (next === null) return;
    event.preventDefault();
    setActiveIndex(next);
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-heading">
          <button className="mobile-menu-btn" onClick={onToggle} aria-label="Open navigation">
            <Menu size={20} />
          </button>
          <div>
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
        </div>

        <div className="topbar-actions">
          <button className="topbar-search" onClick={() => setSearchOpen(true)} aria-label="Search and open commands">
            <Search size={16} />
            <span className="topbar-search-label">Search anything…</span>
            <kbd>⌘ K</kbd>
          </button>
          {websiteUrl ? (
            <a className="topbar-preview" href={websiteUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={16} />
              <span>Preview site</span>
            </a>
          ) : null}
          <button className="topbar-icon-button" onClick={() => setActivityOpen(true)} aria-label="Open activity and notifications">
            <Bell size={17} />
          </button>
          <button className="topbar-icon-button" onClick={() => setHelpOpen(true)} aria-label="Open help">
            <CircleHelp size={17} />
          </button>
        </div>
      </header>

      <Dialog open={searchOpen} onOpenChange={(open) => { setSearchOpen(open); if (!open) setQuery(''); }}>
        <DialogContent className="command-dialog" showCloseButton={false}>
          <DialogTitle className="sr-only">Search and open commands</DialogTitle>
          <div className="command-input-wrap">
            <Search size={18} />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onPaletteKeyDown}
              placeholder={`Search ${clientName}…`}
              aria-label="Search pages and actions"
              // Points assistive tech at the row the arrow keys are on, which
              // is the half of keyboard support that is not visible.
              aria-activedescendant={navigableResults[activeIndex] ? `command-option-${activeIndex}` : undefined}
            />
            <kbd>Esc</kbd>
          </div>
          <div className="command-results" role="listbox" aria-label="Available commands">
            {canSearchContent && searchingContent ? <div className="command-empty">Searching this website…</div> : null}
            {visibleContentResults.map((result, index) => {
              const ResultIcon = result.icon;
              const isActive = index === activeIndex;
              return (
                <button
                  key={`${result.href}-${result.label}`}
                  id={`command-option-${index}`}
                  role="option"
                  aria-selected={isActive}
                  data-active={isActive || undefined}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => runCommand(result.href)}
                >
                  <span className="command-icon"><ResultIcon size={17} /></span>
                  <span><strong>{result.label}</strong><small>{result.description}</small></span>
                  <span className="command-enter">↵</span>
                </button>
              );
            })}
            {filteredCommands.length === 0 ? (
              visibleContentResults.length === 0 && !searchingContent ? <div className="command-empty">No matching content, pages, or actions.</div> : null
            ) : filteredCommands.map((command, index) => {
              const Icon = command.icon;
              const flatIndex = visibleContentResults.length + index;
              const isActive = flatIndex === activeIndex;
              return (
                <button
                  key={command.href}
                  id={`command-option-${flatIndex}`}
                  role="option"
                  aria-selected={isActive}
                  data-active={isActive || undefined}
                  onMouseEnter={() => setActiveIndex(flatIndex)}
                  onClick={() => runCommand(command.href)}
                >
                  <span className="command-icon"><Icon size={17} /></span>
                  <span><strong>{command.label}</strong><small>{command.description}</small></span>
                  <span className="command-enter">↵</span>
                </button>
              );
            })}
          </div>
          <div className="command-footer">Navigate with ↑ ↓ · Open with Enter · Close with Esc</div>
        </DialogContent>
      </Dialog>

      <Dialog open={activityOpen} onOpenChange={setActivityOpen}>
        <DialogContent className="topbar-dialog">
          <DialogHeader>
            <DialogTitle>Activity</DialogTitle>
            <DialogDescription>Important work and recent changes for {clientName}.</DialogDescription>
          </DialogHeader>
          <div className="topbar-dialog-list">
            <Link href="/dashboard#needs-attention" onClick={() => setActivityOpen(false)}><Sparkles size={17} /><span><strong>Needs attention</strong><small>Review drafts, publishing, SEO, and delivery issues.</small></span></Link>
            <Link href="/dashboard#recent-activity" onClick={() => setActivityOpen(false)}><Bell size={17} /><span><strong>Recent activity</strong><small>See the latest changes made by your team.</small></span></Link>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="topbar-dialog">
          <DialogHeader>
            <DialogTitle>Help with {title}</DialogTitle>
            <DialogDescription>Find a destination quickly or contact the Neu Entity team.</DialogDescription>
          </DialogHeader>
          <div className="topbar-dialog-list">
            <button onClick={() => { setHelpOpen(false); setSearchOpen(true); }}><Search size={17} /><span><strong>Search the workspace</strong><small>Press Ctrl/Cmd + K from anywhere.</small></span></button>
            <a href="https://neuentity.com/contact/" target="_blank" rel="noopener noreferrer"><CircleHelp size={17} /><span><strong>Contact Neu Entity</strong><small>Get help from the team managing your website.</small></span></a>
            <a href="https://neuentity.com/" target="_blank" rel="noopener noreferrer"><BookOpen size={17} /><span><strong>About Neu Entity</strong><small>Open the Neu Entity website in a new tab.</small></span></a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
