import { describe, expect, it } from 'vitest';
import { isBotUserAgent } from './bots';

describe('isBotUserAgent', () => {
  it.each([
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
    'Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
  ])('treats a real browser as human: %s', (ua) => {
    expect(isBotUserAgent(ua)).toBe(false);
  });

  it.each([
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/126.0.0.0 Safari/537.36',
    'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
    'curl/8.4.0',
    'python-requests/2.31.0',
    'Mozilla/5.0 (Linux; Android 11) Chrome/126 Mobile Safari/537.36 Chrome-Lighthouse',
    'facebookexternalhit/1.1',
    'Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)',
  ])('flags a crawler / automation UA: %s', (ua) => {
    expect(isBotUserAgent(ua)).toBe(true);
  });

  it('treats a missing or empty UA as a bot', () => {
    expect(isBotUserAgent('')).toBe(true);
    expect(isBotUserAgent(null)).toBe(true);
    expect(isBotUserAgent(undefined)).toBe(true);
  });
});
