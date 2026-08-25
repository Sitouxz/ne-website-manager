import { describe, expect, it } from 'vitest';
import { authenticatesItself } from './proxy';

/**
 * Regression cover for a live bug: `/api/cron/**` was not on this list, so
 * every Vercel Cron invocation was answered with a 307 to `/login` and the
 * route's own `CRON_SECRET` check never ran. Scheduled posts silently never
 * published.
 */
describe('routes exempt from the session gate', () => {
  it('lets Vercel Cron reach its routes', () => {
    expect(authenticatesItself('/api/cron/publish-scheduled')).toBe(true);
    expect(authenticatesItself('/api/cron/rollup-analytics')).toBe(true);
    expect(authenticatesItself('/api/cron/site-health')).toBe(true);
  });

  it('lets a client website reach the public content API', () => {
    expect(authenticatesItself('/api/client/al-islah/posts')).toBe(true);
    expect(authenticatesItself('/api/client/al-islah/sdk')).toBe(true);
  });

  it('lets an MCP client reach the MCP endpoint', () => {
    // A redirect here is especially unhelpful: an MCP client gets a 307 to
    // an HTML page and reports a protocol error, not "your key is missing".
    expect(authenticatesItself('/api/mcp')).toBe(true);
  });

  it('keeps the session gate on everything a person browses', () => {
    for (const path of ['/dashboard', '/cms/posts', '/settings', '/health', '/admin', '/']) {
      expect(authenticatesItself(path), path).toBe(false);
    }
  });

  it('keeps the session gate on session-authenticated API routes', () => {
    // These read the caller's Supabase session — exempting them would remove
    // their only authentication.
    for (const path of ['/api/media', '/api/team/invite', '/api/keys', '/api/health', '/api/ai/suggest']) {
      expect(authenticatesItself(path), path).toBe(false);
    }
  });

  it('does not exempt a lookalike path', () => {
    expect(authenticatesItself('/api/mcp-admin')).toBe(false);
    expect(authenticatesItself('/api/cronjobs')).toBe(false);
    expect(authenticatesItself('/api/clients')).toBe(false);
  });
});
