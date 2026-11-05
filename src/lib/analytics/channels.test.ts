import { describe, expect, it } from 'vitest';
import { channelFromHostSql, classifyHost, deriveChannel } from './channels';

const site = 'zhenghe.com.sg';

describe('deriveChannel', () => {
  it.each([
    // UTM-tagged traffic
    [{ utmSource: 'google', utmMedium: 'cpc' }, 'Paid Search'],
    [{ utmSource: 'trade-portal', utmMedium: 'cpc' }, 'Paid Other'],
    [{ utmSource: 'x', utmMedium: 'cpc' }, 'Paid Social'],
    [{ utmSource: 'facebook', utmMedium: 'paid_social' }, 'Paid Social'],
    [{ utmSource: 'ig', utmMedium: 'paid' }, 'Paid Social'],
    [{ utmSource: 'mailchimp', utmMedium: 'email' }, 'Email'],
    [{ utmSource: 'partner', utmMedium: 'affiliate' }, 'Affiliates'],
    [{ utmSource: 'gdn', utmMedium: 'display' }, 'Display'],
    [{ utmSource: 'linkedin', utmMedium: 'social' }, 'Organic Social'],
    [{ utmSource: 'facebook' }, 'Organic Social'],
    [{ utmSource: 'chatgpt.com' }, 'AI Assistants'],
    [{ utmSource: 'some-blog', utmMedium: 'referral' }, 'Referral'],
    [{ utmSource: 'flyer', utmMedium: 'print' }, 'Other'],
    // Click IDs without UTM
    [{ clickIdType: 'gclid', landingReferrer: 'https://www.google.com/' }, 'Paid Search'],
    [{ clickIdType: 'msclkid' }, 'Paid Search'],
    [{ clickIdType: 'ttclid' }, 'Paid Social'],
    [{ clickIdType: 'fbclid', landingReferrer: 'https://l.facebook.com/' }, 'Organic Social'],
    [{ clickIdType: 'fbclid' }, 'Direct'],
    // Referrer only
    [{ landingReferrer: 'https://www.google.com.sg/' }, 'Organic Search'],
    [{ landingReferrer: 'https://news.google.co.uk/x' }, 'Organic Search'],
    [{ landingReferrer: 'https://gemini.google.com/app' }, 'AI Assistants'],
    [{ landingReferrer: 'https://chatgpt.com/' }, 'AI Assistants'],
    [{ landingReferrer: 'https://www.perplexity.ai/search' }, 'AI Assistants'],
    [{ landingReferrer: 'https://mail.google.com/' }, 'Email'],
    [{ landingReferrer: 'https://lm.facebook.com/l.php' }, 'Organic Social'],
    [{ landingReferrer: 'https://t.co/abc' }, 'Organic Social'],
    [{ landingReferrer: 'https://duckduckgo.com/' }, 'Organic Search'],
    [{ landingReferrer: 'https://some-directory.sg/listing' }, 'Referral'],
    [{ landingReferrer: `https://www.${site}/services`, siteHost: site }, 'Direct'],
    [{ landingReferrer: null }, 'Direct'],
  ] as const)('%o → %s', (input, expected) => {
    expect(deriveChannel({ siteHost: site, ...input })).toBe(expected);
  });

  it('editable extra hosts take precedence', () => {
    expect(deriveChannel({ landingReferrer: 'https://partner.example/', extraHosts: [{ host: 'partner.example', name: 'Partner', category: 'social' }] }))
      .toBe('Organic Social');
  });

  it('does not mistake a host that merely contains a brand for it', () => {
    expect(classifyHost('notgoogle.com')).toBeNull();
    expect(classifyHost('googleusercontent.com')).toBeNull();
    expect(classifyHost('google.com')?.name).toBe('Google');
  });
});

describe('channelFromHostSql', () => {
  it('builds a CASE expression over the same host lists', () => {
    const sql = channelFromHostSql('e.referrer_host', 'site.host');
    expect(sql).toContain("THEN 'AI Assistants'");
    expect(sql).toContain('chatgpt\\.com');
    // AI is matched before search, so gemini.google.com is not Organic Search.
    expect(sql.indexOf("'AI Assistants'")).toBeLessThan(sql.indexOf("'Organic Search'"));
  });
});

describe('migration 028 stays in sync with channels.ts', () => {
  it('embeds exactly the CASE generated from HOST_RULES', async () => {
    const { readFileSync } = await import('node:fs');
    const sql = readFileSync('supabase/migrations/028_analytics_attribution.sql', 'utf8');
    // If this fails after editing HOST_RULES: regenerate the function body with
    // channelFromHostSql('p_host', 'p_site_host') in a new migration.
    expect(sql).toContain(channelFromHostSql('p_host', 'p_site_host'));
  });
});
