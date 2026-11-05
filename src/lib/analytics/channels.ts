/**
 * Channel grouping (Analytics v2, Phase 2). Pure and server-side: the beacon
 * derives `channel` for every event from the session's attribution (UTM
 * parameters, ad click IDs, the landing referrer) — never trusting a channel
 * the client claims.
 *
 * Rules, in order (first match wins), modelled on GA4's default channel group:
 *  1. UTM medium/source, when present:
 *     - medium cpc, ppc, paid…, retargeting → Paid Search if the source is a search
 *       engine, Paid Social if it is a social network, else Paid Other
 *     - display/banner/cpm/interstitial → Display
 *     - email/e-mail/newsletter → Email
 *     - affiliate(s) → Affiliates
 *     - social/social-media/sm → Organic Social
 *     - organic → Organic Search
 *     - referral → Referral
 *     - otherwise classify the utm_source like a referrer host (below), else Other
 *  2. Ad click IDs: gclid/gbraid/wbraid/msclkid → Paid Search, dclid → Display,
 *     ttclid/li_fat_id/twclid → Paid Social. (fbclid is added to *organic*
 *     Facebook/Instagram link clicks too, so it is not treated as paid.)
 *  3. Landing referrer host: AI assistants (chatgpt.com, perplexity.ai, …) →
 *     AI Assistants; search engines → Organic Search; social networks →
 *     Organic Social; webmail → Email; the site's own host → Direct; any other
 *     host → Referral.
 *  4. No referrer → Direct.
 *
 * Host lists are below; `extraHosts` (the editable `analytics_traffic_sources`
 * table, migration 028) can add or override entries without a deploy.
 */

/** Lower-cased hostname without a leading `www.`, or null. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return host || null;
  } catch {
    return null;
  }
}

export const CHANNELS = [
  'Organic Search', 'Paid Search', 'Organic Social', 'Paid Social', 'AI Assistants', 'Email',
  'Display', 'Affiliates', 'Referral', 'Paid Other', 'Direct', 'Other',
] as const;
export type Channel = (typeof CHANNELS)[number];

export type SourceCategory = 'search' | 'social' | 'ai' | 'email';

/** Suffix match: an entry `google` matches google.com, google.com.sg, www.google.co.uk. */
type HostRule = { pattern: string; name: string; category: SourceCategory };

const R = (category: SourceCategory, entries: [string, string][]): HostRule[] =>
  entries.map(([pattern, name]) => ({ pattern, name, category }));

/** Checked in this order, so specific hosts (gemini.google.com) precede broad ones (google). */
export const HOST_RULES: HostRule[] = [
  ...R('ai', [
    ['chatgpt.com', 'ChatGPT'], ['chat.openai.com', 'ChatGPT'], ['perplexity.ai', 'Perplexity'],
    ['gemini.google.com', 'Gemini'], ['bard.google.com', 'Gemini'], ['copilot.microsoft.com', 'Copilot'],
    ['claude.ai', 'Claude'], ['you.com', 'You.com'], ['phind.com', 'Phind'], ['poe.com', 'Poe'],
    ['chat.deepseek.com', 'DeepSeek'], ['deepseek.com', 'DeepSeek'], ['meta.ai', 'Meta AI'], ['grok.com', 'Grok'],
    ['chat.mistral.ai', 'Mistral'],
  ]),
  ...R('email', [
    ['mail.google.com', 'Gmail'], ['outlook.live.com', 'Outlook'], ['outlook.office.com', 'Outlook'],
    ['outlook.office365.com', 'Outlook'], ['mail.yahoo.com', 'Yahoo Mail'], ['mail.proton.me', 'Proton Mail'],
    ['mail.zoho.com', 'Zoho Mail'],
  ]),
  ...R('search', [
    ['google', 'Google'], ['bing.com', 'Bing'], ['yahoo', 'Yahoo'], ['duckduckgo.com', 'DuckDuckGo'],
    ['baidu.com', 'Baidu'], ['yandex', 'Yandex'], ['ecosia.org', 'Ecosia'], ['naver.com', 'Naver'],
    ['search.brave.com', 'Brave Search'], ['startpage.com', 'Startpage'], ['sogou.com', 'Sogou'],
    ['so.com', '360 Search'], ['seznam.cz', 'Seznam'], ['qwant.com', 'Qwant'], ['coccoc.com', 'Cốc Cốc'],
    ['daum.net', 'Daum'], ['ask.com', 'Ask'],
  ]),
  ...R('social', [
    ['facebook.com', 'Facebook'], ['fb.com', 'Facebook'], ['fb.me', 'Facebook'], ['instagram.com', 'Instagram'],
    ['t.co', 'X (Twitter)'], ['twitter.com', 'X (Twitter)'], ['x.com', 'X (Twitter)'], ['linkedin.com', 'LinkedIn'],
    ['lnkd.in', 'LinkedIn'], ['pinterest', 'Pinterest'], ['pin.it', 'Pinterest'], ['reddit.com', 'Reddit'],
    ['youtube.com', 'YouTube'], ['youtu.be', 'YouTube'], ['tiktok.com', 'TikTok'], ['threads.net', 'Threads'],
    ['whatsapp.com', 'WhatsApp'], ['wa.me', 'WhatsApp'], ['t.me', 'Telegram'], ['telegram.org', 'Telegram'],
    ['xiaohongshu.com', 'Xiaohongshu'], ['weibo.com', 'Weibo'], ['line.me', 'LINE'], ['snapchat.com', 'Snapchat'],
    ['quora.com', 'Quora'], ['discord.com', 'Discord'], ['tumblr.com', 'Tumblr'], ['vk.com', 'VK'],
    ['bsky.app', 'Bluesky'], ['medium.com', 'Medium'],
  ]),
];

/** Social/search names a utm_source can be written as ("fb", "ig", "google"). */
const SOURCE_ALIASES: Record<string, { name: string; category: SourceCategory }> = {
  google: { name: 'Google', category: 'search' }, bing: { name: 'Bing', category: 'search' },
  yahoo: { name: 'Yahoo', category: 'search' }, baidu: { name: 'Baidu', category: 'search' },
  duckduckgo: { name: 'DuckDuckGo', category: 'search' },
  facebook: { name: 'Facebook', category: 'social' }, fb: { name: 'Facebook', category: 'social' },
  meta: { name: 'Facebook', category: 'social' }, instagram: { name: 'Instagram', category: 'social' },
  ig: { name: 'Instagram', category: 'social' }, linkedin: { name: 'LinkedIn', category: 'social' },
  twitter: { name: 'X (Twitter)', category: 'social' }, x: { name: 'X (Twitter)', category: 'social' },
  tiktok: { name: 'TikTok', category: 'social' }, youtube: { name: 'YouTube', category: 'social' },
  pinterest: { name: 'Pinterest', category: 'social' }, reddit: { name: 'Reddit', category: 'social' },
  whatsapp: { name: 'WhatsApp', category: 'social' }, telegram: { name: 'Telegram', category: 'social' },
  chatgpt: { name: 'ChatGPT', category: 'ai' }, 'chatgpt.com': { name: 'ChatGPT', category: 'ai' },
  perplexity: { name: 'Perplexity', category: 'ai' },
  newsletter: { name: 'Newsletter', category: 'email' }, email: { name: 'Email', category: 'email' },
};

export const CLICK_ID_PARAMS = ['gclid', 'gbraid', 'wbraid', 'msclkid', 'dclid', 'fbclid', 'ttclid', 'li_fat_id', 'twclid'] as const;
export type ClickIdType = (typeof CLICK_ID_PARAMS)[number];

const CLICK_ID_CHANNEL: Record<ClickIdType, Channel | null> = {
  gclid: 'Paid Search', gbraid: 'Paid Search', wbraid: 'Paid Search', msclkid: 'Paid Search',
  dclid: 'Display', ttclid: 'Paid Social', li_fat_id: 'Paid Social', twclid: 'Paid Social',
  fbclid: null,
};

export type ExtraHost = { host: string; name: string; category: SourceCategory };

function hostMatches(host: string, pattern: string) {
  if (!pattern.includes('.')) {
    // A bare brand ("google", "yahoo") matches any label: google.com, www.google.com.sg, news.google.co.uk
    return host.split('.').includes(pattern);
  }
  return host === pattern || host.endsWith(`.${pattern}`);
}

/** Classifies a referrer host into a known source, or null for an ordinary website. */
export function classifyHost(host: string | null | undefined, extraHosts: ExtraHost[] = []): { name: string; category: SourceCategory } | null {
  if (!host) return null;
  const h = host.toLowerCase().replace(/^www\./, '');
  for (const extra of extraHosts) {
    if (hostMatches(h, extra.host.toLowerCase())) return { name: extra.name, category: extra.category };
  }
  for (const rule of HOST_RULES) {
    if (hostMatches(h, rule.pattern)) return { name: rule.name, category: rule.category };
  }
  return null;
}

function classifySource(source: string, extraHosts: ExtraHost[]) {
  const s = source.toLowerCase().trim();
  return SOURCE_ALIASES[s] ?? classifyHost(s.includes('.') ? s : null, extraHosts);
}

const ORGANIC_BY_CATEGORY: Record<SourceCategory, Channel> = {
  search: 'Organic Search', social: 'Organic Social', ai: 'AI Assistants', email: 'Email',
};

export type AttributionInput = {
  utmSource?: string | null;
  utmMedium?: string | null;
  clickIdType?: string | null;
  /** The referrer the session landed with (not an internal page). */
  landingReferrer?: string | null;
  /** The client site's own host, so self-referrals count as Direct. */
  siteHost?: string | null;
  extraHosts?: ExtraHost[];
};

export function deriveChannel(input: AttributionInput): Channel {
  const extra = input.extraHosts ?? [];
  const medium = input.utmMedium?.toLowerCase().trim() || '';
  const source = input.utmSource?.trim() || '';

  if (medium || source) {
    const src = source ? classifySource(source, extra) : null;
    if (/^(.*cp.*|ppc|retargeting|paid.*)$/.test(medium)) {
      if (src?.category === 'search') return 'Paid Search';
      if (src?.category === 'social') return 'Paid Social';
      return 'Paid Other';
    }
    if (/^(display|banner|expandable|interstitial|cpm)$/.test(medium)) return 'Display';
    if (/^(e[-_ ]?mail|newsletter)$/.test(medium)) return 'Email';
    if (/^affiliates?$/.test(medium)) return 'Affiliates';
    if (/^(social|social[-_ ]?network|social[-_ ]?media|sm)$/.test(medium)) return 'Organic Social';
    if (medium === 'organic') return 'Organic Search';
    if (medium === 'referral') return 'Referral';
    if (src) return ORGANIC_BY_CATEGORY[src.category];
    return 'Other';
  }

  const clickId = input.clickIdType as ClickIdType | null | undefined;
  if (clickId && CLICK_ID_CHANNEL[clickId]) return CLICK_ID_CHANNEL[clickId]!;

  const host = hostOf(input.landingReferrer);
  if (!host) return 'Direct';
  const site = input.siteHost?.toLowerCase().replace(/^www\./, '');
  if (site && (host === site || host.endsWith(`.${site}`))) return 'Direct';
  const known = classifyHost(host, extra);
  if (known) return ORGANIC_BY_CATEGORY[known.category];
  if (clickId === 'fbclid') return 'Organic Social';
  return 'Referral';
}

/**
 * SQL CASE expression assigning a channel from `referrer_host` alone, for
 * backfilling rows that predate channel derivation (they have no UTM or
 * click-ID data). Generated from HOST_RULES so the backfill and the beacon
 * share one definition. `siteHostExpr` is a SQL expression for the client's
 * own host.
 */
export function channelFromHostSql(hostExpr: string, siteHostExpr: string): string {
  const byCategory = (cat: SourceCategory) => HOST_RULES.filter((r) => r.category === cat).map((r) => r.pattern);
  const regex = (patterns: string[]) => {
    const parts = patterns.map((p) => (p.includes('.')
      ? `(^|\\.)${p.replace(/\./g, '\\.')}$`
      : `(^|\\.)${p}(\\.|$)`));
    return `'${parts.join('|')}'`;
  };
  return `CASE
    WHEN ${hostExpr} IS NULL THEN 'Direct'
    WHEN ${hostExpr} = ${siteHostExpr} OR ${hostExpr} LIKE '%.' || ${siteHostExpr} THEN 'Direct'
    WHEN ${hostExpr} ~ ${regex(byCategory('ai'))} THEN 'AI Assistants'
    WHEN ${hostExpr} ~ ${regex(byCategory('email'))} THEN 'Email'
    WHEN ${hostExpr} ~ ${regex(byCategory('search'))} THEN 'Organic Search'
    WHEN ${hostExpr} ~ ${regex(byCategory('social'))} THEN 'Organic Social'
    ELSE 'Referral'
  END`;
}
