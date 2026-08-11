'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ElementType } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Bell,
  BookOpen,
  Boxes,
  CircleHelp,
  ExternalLink,
  FileEdit,
  FileText,
  Image,
  LayoutDashboard,
  Menu,
  Navigation,
  Search,
  Settings,
  Sparkles,
} from 'lucide-react';
import { useMobileMenu, useSelectedClient } from './AppShell';
import { createClient } from '@/lib/supabase/client';
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
  { label: 'Settings', description: 'Configure this website', href: '/settings', icon: Settings },
];

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
      const pattern = `%${normalized.replace(/[%_]/g, '\\$&')}%`;
      const [posts, pages, media, collections] = await Promise.all([
        supabase.from('posts').select('id,title,status').eq('client_id', selectedClientId).ilike('title', pattern).limit(5),
        supabase.from('pages').select('id,title,path').eq('client_id', selectedClientId).ilike('title', pattern).limit(5),
        supabase.from('media').select('id,filename,alt').eq('client_id', selectedClientId).or(`filename.ilike.${pattern},alt.ilike.${pattern}`).limit(5),
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
  const visibleContentResults = canSearchContent && contentResultClientId === selectedClientId ? contentResults : [];

  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return COMMANDS;
    return COMMANDS.filter((command) =>
      `${command.label} ${command.description}`.toLowerCase().includes(normalized),
    );
  }, [query]);

  function runCommand(href: string) {
    setSearchOpen(false);
    setQuery('');
    router.push(href);
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
              placeholder={`Search ${clientName}…`}
              aria-label="Search pages and actions"
            />
            <kbd>Esc</kbd>
          </div>
          <div className="command-results" role="listbox" aria-label="Available commands">
            {canSearchContent && searchingContent ? <div className="command-empty">Searching this website…</div> : null}
            {visibleContentResults.map((result) => {
              const ResultIcon = result.icon;
              return (
                <button key={`${result.href}-${result.label}`} role="option" aria-selected="false" onClick={() => runCommand(result.href)}>
                  <span className="command-icon"><ResultIcon size={17} /></span>
                  <span><strong>{result.label}</strong><small>{result.description}</small></span>
                  <span className="command-enter">↵</span>
                </button>
              );
            })}
            {filteredCommands.length === 0 ? (
              visibleContentResults.length === 0 && !searchingContent ? <div className="command-empty">No matching content, pages, or actions.</div> : null
            ) : filteredCommands.map((command) => {
              const Icon = command.icon;
              return (
                <button key={command.href} role="option" aria-selected="false" onClick={() => runCommand(command.href)}>
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
