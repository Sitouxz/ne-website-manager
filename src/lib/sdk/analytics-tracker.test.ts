import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import { generateAnalyticsTracker } from './analytics-tracker';
import { generateV3Sdk, generateV2ServerSdk } from './generate';

/**
 * Behavioural tests for the generated v3 tracker: the generated TypeScript is
 * transpiled and executed in this jsdom environment, with fetch/sendBeacon
 * stubbed, so these tests exercise exactly the code a client site runs.
 */

type Tracker = {
  installAnalytics: (opts?: Record<string, unknown>) => void;
  trackEvent: (name: string, meta?: Record<string, unknown>) => Promise<void>;
  trackPageView: () => Promise<void>;
  disableAnalytics: () => void;
  enableAnalytics: () => void;
};

type Sent = Record<string, unknown>;

const SOURCE = generateAnalyticsTracker('acme', 'https://cms.example.com');

function load(): Tracker {
  const js = ts.transpileModule(SOURCE, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  new Function('exports', js)(exports);
  return exports as unknown as Tracker;
}

let sent: Sent[] = [];
let urls: string[] = [];
// Each load() installs listeners on the shared jsdom window/document; record
// them so afterEach can remove them and tests stay independent.
let added: [EventTarget, string, EventListenerOrEventListenerObject, unknown][] = [];
const realWindowAdd = window.addEventListener.bind(window);
const realDocAdd = document.addEventListener.bind(document);
const originalPush = history.pushState;
const originalReplace = history.replaceState;

function collect(body: string) {
  sent.push(...(JSON.parse(body).events as Sent[]));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-30T03:00:00Z'));
  sent = [];
  urls = [];
  localStorage.clear();
  sessionStorage.clear();
  history.pushState = originalPush;
  history.replaceState = originalReplace;
  originalReplace.call(history, null, '', '/');
  Object.defineProperty(document, 'referrer', { value: 'https://www.google.com/', configurable: true });
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
    urls.push(url);
    collect(init.body as string);
    return Promise.resolve(new Response(null, { status: 204 }));
  }));
  added = [];
  window.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, o?: unknown) => {
    added.push([window, type, fn, o]);
    realWindowAdd(type, fn, o as AddEventListenerOptions);
  }) as typeof window.addEventListener;
  document.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, o?: unknown) => {
    added.push([document, type, fn, o]);
    realDocAdd(type, fn, o as AddEventListenerOptions);
  }) as typeof document.addEventListener;
  // jsdom serves on localhost, which the tracker skips by default — most
  // tests pass trackLocalhost: true.
});

afterEach(() => {
  for (const [target, type, fn, o] of added) target.removeEventListener(type, fn, o as EventListenerOptions);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const views = () => sent.filter((e) => e.event_name === 'page_view');
const leaves = () => sent.filter((e) => e.event_name === 'page_leave');

describe('generated tracker v3', () => {
  it('sends one page view on install, batched to the batch endpoint, with v3 fields', () => {
    const t = load();
    t.installAnalytics({ trackLocalhost: true });
    t.installAnalytics({ trackLocalhost: true }); // StrictMode double-invoke
    vi.advanceTimersByTime(1100);

    expect(urls).toEqual(['https://cms.example.com/api/client/acme/analytics/batch']);
    expect(views()).toHaveLength(1);
    expect(views()[0]).toMatchObject({
      path: '/', referrer: 'https://www.google.com/', is_entry: true, is_new_visitor: true, tv: 3,
    });
    expect(typeof views()[0].visitor_id).toBe('string');
  });

  it('does not track localhost unless asked to', () => {
    const t = load();
    t.installAnalytics();
    vi.advanceTimersByTime(1100);
    expect(sent).toHaveLength(0);
  });

  it('ignores replaceState with the same path (Next.js) and de-dupes, but counts pushState navigations', () => {
    const t = load();
    t.installAnalytics({ trackLocalhost: true });
    history.replaceState({ __N: true }, '', '/');
    history.replaceState({ __N: true }, '', '/?filter=a');
    history.pushState({}, '', '/about');
    vi.advanceTimersByTime(10);
    t.trackPageView(); // same URL within 1 s → de-duped
    vi.advanceTimersByTime(1100);

    expect(views().map((e) => e.path)).toEqual(['/', '/about']);
  });

  it('sends the previous page as referrer on SPA navigation, not document.referrer', () => {
    const t = load();
    t.installAnalytics({ trackLocalhost: true });
    history.pushState({}, '', '/services');
    vi.advanceTimersByTime(10);
    history.pushState({}, '', '/contact');
    vi.advanceTimersByTime(1100);

    const v = views();
    expect(v.map((e) => e.referrer)).toEqual([
      'https://www.google.com/',
      `${location.origin}/`,
      `${location.origin}/services`,
    ]);
    expect(v.map((e) => e.is_entry)).toEqual([true, false, false]);
  });

  it('counts a pathname change via replaceState (router.replace)', () => {
    const t = load();
    t.installAnalytics({ trackLocalhost: true });
    history.replaceState({}, '', '/login');
    vi.advanceTimersByTime(1100);
    expect(views().map((e) => e.path)).toEqual(['/', '/login']);
  });

  it('sends page_leave with engaged time and scroll on navigation', () => {
    const t = load();
    t.installAnalytics({ trackLocalhost: true });
    // 6 s of activity: a pointer move every second
    for (let i = 0; i < 6; i++) {
      window.dispatchEvent(new Event('pointermove'));
      vi.advanceTimersByTime(1000);
    }
    // then idle for 30 s: only the first ~10 s after the last activity count
    vi.advanceTimersByTime(30_000);
    history.pushState({}, '', '/next');
    vi.advanceTimersByTime(1100);

    const [leave] = leaves();
    expect(leave.path).toBe('/');
    expect(leave.engaged_ms).toBeGreaterThanOrEqual(14_000);
    expect(leave.engaged_ms).toBeLessThanOrEqual(16_000);
    expect(leave.scroll_pct).toBeTypeOf('number');
  });

  it('flushes on tab hide with sendBeacon, sending engaged time as a delta', () => {
    const bodies: string[] = [];
    const beacon = vi.fn((_url: string, blob: Blob) => {
      void blob.text().then((b) => bodies.push(b));
      return true;
    });
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    const t = load();
    t.installAnalytics({ trackLocalhost: true });
    vi.advanceTimersByTime(3000);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(beacon).toHaveBeenCalledTimes(1);
    expect((beacon.mock.calls[0][1] as Blob).type).toBe('text/plain');
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(2000);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(beacon).toHaveBeenCalledTimes(2);
    delete (navigator as unknown as Record<string, unknown>).sendBeacon;
  });

  it('marks the visitor returning in a later session', () => {
    load().installAnalytics({ trackLocalhost: true });
    vi.advanceTimersByTime(1100);
    sessionStorage.clear(); // new tab / session, same visitor
    const t2 = load();
    t2.installAnalytics({ trackLocalhost: true });
    vi.advanceTimersByTime(1100);
    expect(views().map((e) => e.is_new_visitor)).toEqual([true, false]);
    expect(views()[1].is_entry).toBe(true);
  });

  it('respects opt-out and consent', () => {
    const t = load();
    t.disableAnalytics();
    t.installAnalytics({ trackLocalhost: true });
    t.trackEvent('x');
    vi.advanceTimersByTime(1100);
    expect(sent).toHaveLength(0);
    t.enableAnalytics();
    t.trackEvent('y');
    vi.advanceTimersByTime(1100);
    expect(sent.map((e) => e.event_name)).toEqual(['y']);

    const t2 = load();
    t2.installAnalytics({ trackLocalhost: true, consent: () => false });
    vi.advanceTimersByTime(1100);
    expect(sent).toHaveLength(1);
  });

  it('batches at most 20 events per request', () => {
    const t = load();
    t.installAnalytics({ trackLocalhost: true });
    for (let i = 0; i < 25; i++) t.trackEvent('burst');
    vi.advanceTimersByTime(1100);
    expect(urls).toHaveLength(2);
    expect(sent).toHaveLength(26);
    expect(sent.filter((e) => e.event_name === 'burst')).toHaveLength(25);
  });
});

describe('generated v3 files type-check under strict TypeScript', () => {
  it('lib/ne-analytics.ts, lib/cms.ts and lib/cms-server.ts compile with no errors', () => {
    const files: Record<string, string> = {
      '/proj/lib/ne-analytics.ts': SOURCE,
      '/proj/lib/cms.ts': generateV3Sdk('acme', 'https://cms.example.com', [
        { slug: 'faq', name: 'FAQ', name_singular: 'FAQ', fields: [{ key: 'q', label: 'Q', type: 'text', required: true }] },
      ] as never),
      '/proj/lib/cms-server.ts': generateV2ServerSdk('acme', 'https://cms.example.com'),
      '/proj/shims.d.ts': `
        declare module 'next/cache' { export function revalidatePath(p: string, t?: string): void; }
        declare module 'next/headers' { export function draftMode(): Promise<{ enable(): void }>; }
        declare module 'next/navigation' { export function redirect(p: string): never; }
        declare module 'crypto' {
          export function createHmac(a: string, k: string): { update(b: string): { digest(e: string): string } };
          export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
        }
        declare const Buffer: { from(s: string, e: string): Uint8Array & { length: number } };
        interface RequestInit { next?: { revalidate?: number } }
      `,
    };
    const options: ts.CompilerOptions = {
      strict: true, noEmit: true, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ['lib.es2020.d.ts', 'lib.dom.d.ts'], skipLibCheck: true,
      noUnusedLocals: true,
    };
    const host = ts.createCompilerHost(options);
    const readFile = host.readFile.bind(host);
    const fileExists = host.fileExists.bind(host);
    host.readFile = (f) => files[f] ?? readFile(f);
    host.fileExists = (f) => f in files || fileExists(f);
    const directoryExists = host.directoryExists?.bind(host);
    host.directoryExists = (d) => d.startsWith('/proj') || (directoryExists ? directoryExists(d) : false);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (f, lang) => (f in files ? ts.createSourceFile(f, files[f], lang) : getSourceFile(f, lang));
    const program = ts.createProgram(Object.keys(files), options, host);
    const diags = ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    expect(diags).toEqual([]);
  }, 30_000);
});

describe('generated tracker v3 — attribution', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      collect(init.body as string);
      return Promise.resolve(new Response(null, { status: 204 }));
    }));
  });

  it('captures UTM and click-ID type on landing and attaches them to every event in the session', () => {
    originalReplace.call(history, null, '', '/promo?utm_source=google&utm_medium=cpc&utm_campaign=spring&gclid=SECRET123');
    const t = load();
    t.installAnalytics({ trackLocalhost: true });
    history.pushState({}, '', '/contact');
    vi.advanceTimersByTime(10);
    t.trackEvent('form_submit');
    vi.advanceTimersByTime(1100);

    expect(sent.length).toBeGreaterThanOrEqual(3);
    for (const e of sent) {
      expect(e).toMatchObject({
        utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'spring', click_id_type: 'gclid',
        landing_path: '/promo', session_referrer: 'https://www.google.com/',
      });
    }
    // The click ID value itself is never sent.
    expect(JSON.stringify(sent)).not.toContain('SECRET123');
  });

  it('records landing path and referrer even without campaign parameters', () => {
    originalReplace.call(history, null, '', '/');
    load().installAnalytics({ trackLocalhost: true });
    vi.advanceTimersByTime(1100);
    expect(sent[0]).toMatchObject({ landing_path: '/', session_referrer: 'https://www.google.com/' });
    expect(sent[0].utm_source).toBeUndefined();
  });
});
