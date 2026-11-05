/**
 * Bot / crawler detection for the analytics beacon.
 *
 * Runs on the User-Agent the beacon request arrives with. Events from bots are
 * still stored (flagged `is_bot`) rather than dropped, so the numbers stay
 * auditable and the Analytics screen can show them on request.
 *
 * A UA check only catches bots that identify themselves. Traffic that spoofs a
 * normal browser UA (e.g. some scrapers on datacenter IPs) can't be detected
 * here.
 */
const BOT_PATTERN = new RegExp(
  [
    'bot', 'crawl', 'spider', 'slurp', 'scrape', 'headless', 'phantomjs', 'puppeteer', 'playwright',
    'selenium', 'webdriver', 'lighthouse', 'pagespeed', 'gtmetrix', 'pingdom', 'uptime', 'monitor',
    'curl/', 'wget/', 'python-', 'aiohttp', 'httpx', 'node-fetch', 'axios/', 'go-http-client',
    'java/', 'okhttp', 'libwww', 'httpclient', 'apache-http', 'scrapy', 'postman',
    'facebookexternalhit', 'whatsapp', 'telegram', 'discord', 'slack', 'linkedinbot', 'twitterbot',
    'preview', 'ahrefs', 'semrush', 'mj12', 'dotbot', 'petalbot', 'bytespider', 'gptbot', 'claude',
    'ccbot', 'perplexity', 'chatgpt', 'anthropic', 'applebot', 'duckduck', 'yandex', 'baidu',
    'sogou', 'exabot', 'ia_archiver', 'archive.org', 'feedfetcher', 'feedly', 'google-read-aloud',
    'google-inspectiontool', 'chrome-lighthouse', 'vercel', 'netlify',
  ].join('|'),
  'i',
);

/** True when the User-Agent is empty or matches a known crawler/automation signature. */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  const ua = (userAgent ?? '').trim();
  if (!ua) return true;
  return BOT_PATTERN.test(ua);
}
