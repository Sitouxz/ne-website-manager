import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hashApiKey } from '@/lib/api/auth';
import { logActivity } from '@/lib/activity';
import { loadHealthReport } from '@/lib/health/load';
import { findEntryUsages, findPageUsages, findPostUsages } from '@/lib/media/usage';
import {
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_INFO,
  MCP_TOOLS,
  RPC_INTERNAL_ERROR,
  RPC_INVALID_PARAMS,
  RPC_INVALID_REQUEST,
  RPC_METHOD_NOT_FOUND,
  RPC_PARSE_ERROR,
  clampLimit,
  findTool,
  isNotification,
  parseRpcRequest,
  rpcError,
  rpcResult,
  toolErrorResult,
  toolTextResult,
} from '@/lib/mcp/tools';
import type { Collection } from '@/lib/supabase/types';

/**
 * MCP endpoint — the CMS as a set of tools an AI agent can call.
 *
 * See `src/lib/mcp/tools.ts` for what is exposed and why. This file is the
 * transport and the security boundary.
 *
 * ## Authorization
 *
 * A per-client API key (`api_keys`, migration 004) as
 * `Authorization: Bearer ne_<prefix>_<secret>` — the same credential a
 * client website already uses, with the same SHA-256 storage and the same
 * revocation. The key resolves to exactly one `client_id`, and **every query
 * below is filtered by that id explicitly**.
 *
 * ## Why the admin client, and what pays for it
 *
 * There is no user session here, so RLS has no `my_client_id()` to evaluate
 * — the service-role client is the only option, exactly as in the cron
 * routes. That makes tenant isolation this file's responsibility rather than
 * the database's: `clientId` comes from the verified key and is applied as
 * an `.eq('client_id', ...)` on every read and every write, and no caller
 * input is ever allowed to name a client. `update_entry_draft` additionally
 * re-checks ownership of the row before touching it, because an entry id is
 * a caller-supplied value and an `.eq('id', ...)` alone would cross tenants.
 *
 * ## What it cannot do
 *
 * No tool publishes, unpublishes, archives or deletes. The one write sets
 * `data` on an entry and never `status`, so a published entry keeps serving
 * its current content until a person publishes the change through the
 * editor. Migrations 015 and 016 defend that transition from inside the
 * app; this endpoint must not be a way around them.
 */

export const dynamic = 'force-dynamic';

interface KeyedClient {
  clientId: string;
  clientName: string;
  keyId: string;
}

/**
 * Resolves the bearer key to a client without needing a slug in the URL.
 *
 * `resolveApiAccess` takes a client slug because the public content API is
 * addressed per-client (`/api/client/[slug]/...`). MCP has one endpoint, so
 * the key alone has to identify the tenant — the lookup is by `prefix` and
 * the secret is then verified against the stored hash, which is the same
 * two-step that helper performs.
 */
async function resolveKey(
  req: Request,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<KeyedClient | null> {
  const header = req.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const match = /^ne_([A-Za-z0-9]+)_([A-Za-z0-9]+)$/.exec(presented);
  if (!match) return null;

  const { data: keyRow } = await supabase
    .from('api_keys')
    .select('id, client_id, key_hash, revoked_at')
    .eq('prefix', match[1])
    .single();

  if (!keyRow || keyRow.revoked_at) return null;
  if (typeof keyRow.key_hash !== 'string') return null;

  const presentedHash = hashApiKey(presented);
  // Length-checked constant-time-ish compare: both sides are fixed-length
  // hex digests, so a plain mismatch on length is not informative.
  if (presentedHash.length !== keyRow.key_hash.length) return null;
  let diff = 0;
  for (let i = 0; i < presentedHash.length; i += 1) {
    diff |= presentedHash.charCodeAt(i) ^ keyRow.key_hash.charCodeAt(i);
  }
  if (diff !== 0) return null;

  const { data: client } = await supabase
    .from('clients')
    .select('id, name')
    .eq('id', keyRow.client_id)
    .single();

  if (!client) return null;

  // Best-effort; never blocks the call.
  await supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyRow.id);

  return { clientId: client.id as string, clientName: client.name as string, keyId: keyRow.id as string };
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  ctx: KeyedClient,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<unknown> {
  switch (name) {
    case 'list_collections': {
      const { data } = await supabase
        .from('collections')
        .select('id, slug, name, name_singular, fields, options')
        .eq('client_id', ctx.clientId)
        .order('sort_order');
      return toolTextResult(
        (data ?? []).map((c) => ({
          id: c.id,
          slug: c.slug,
          name: c.name,
          fields: ((c.fields ?? []) as Collection['fields']).map((f) => ({
            key: f.key,
            label: f.label,
            type: f.type,
            required: f.required ?? false,
            // Surfaced so an agent does not write to a field the editor has
            // retired — the value would be served to the website but never
            // be editable by a human afterwards.
            hidden: f.deprecated ?? false,
          })),
        })),
      );
    }

    case 'list_entries': {
      const collectionId = args.collection_id;
      if (typeof collectionId !== 'string') return toolErrorResult('collection_id is required.');

      let query = supabase
        .from('collection_items')
        .select('id, slug, status, updated_at, data')
        .eq('client_id', ctx.clientId)
        .eq('collection_id', collectionId)
        .order('updated_at', { ascending: false })
        .limit(clampLimit(args.limit));

      if (typeof args.status === 'string') query = query.eq('status', args.status);

      const { data, error } = await query;
      if (error) return toolErrorResult(error.message);
      return toolTextResult(data ?? []);
    }

    case 'update_entry_draft': {
      const entryId = args.entry_id;
      const patch = args.data;
      if (typeof entryId !== 'string') return toolErrorResult('entry_id is required.');
      if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
        return toolErrorResult('data must be an object of field keys to values.');
      }

      // Ownership is re-checked rather than assumed: `entry_id` is caller
      // input, and the admin client would happily update another tenant's
      // row if the update were filtered on id alone.
      const { data: existing } = await supabase
        .from('collection_items')
        .select('id, client_id, collection_id, status, data')
        .eq('id', entryId)
        .eq('client_id', ctx.clientId)
        .single();

      if (!existing) return toolErrorResult('No such entry for this website.');

      const merged = { ...((existing.data ?? {}) as Record<string, unknown>), ...(patch as Record<string, unknown>) };

      // `status` is deliberately absent from this update. Publishing stays a
      // human action; see this file's header.
      const { error } = await supabase
        .from('collection_items')
        .update({ data: merged })
        .eq('id', entryId)
        .eq('client_id', ctx.clientId);

      if (error) return toolErrorResult(error.message);

      await logActivity(supabase, {
        clientId: ctx.clientId,
        actorId: null,
        action: 'updated',
        entityType: 'collection_entry',
        entityId: entryId,
        summary: `An assistant updated ${Object.keys(patch).join(', ')} on an entry`,
        meta: { via: 'mcp', api_key_id: ctx.keyId, keys: Object.keys(patch) },
      });

      return toolTextResult({
        ok: true,
        entry_id: entryId,
        updated_keys: Object.keys(patch),
        status: existing.status,
        note:
          existing.status === 'published'
            ? 'This entry is published. The website keeps serving its current content until someone publishes the change in the CMS.'
            : 'Draft updated.',
      });
    }

    case 'find_content_gaps': {
      const report = await loadHealthReport(supabase, { id: ctx.clientId, name: ctx.clientName });
      return toolTextResult({
        problems: report.problemCount,
        tidy: report.tidyCount,
        findings: report.findings.map((f) => ({ code: f.code, subject: f.subject, message: f.message })),
      });
    }

    case 'find_media_usage': {
      const url = args.url;
      if (typeof url !== 'string' || url.trim() === '') return toolErrorResult('url is required.');

      const [posts, pages, entries, collections] = await Promise.all([
        supabase.from('posts').select('*').eq('client_id', ctx.clientId),
        supabase.from('pages').select('*').eq('client_id', ctx.clientId),
        supabase.from('collection_items').select('*').eq('client_id', ctx.clientId),
        supabase.from('collections').select('id, name_singular').eq('client_id', ctx.clientId),
      ]);

      const usages = [
        ...findPostUsages(posts.data ?? [], url),
        ...findPageUsages(pages.data ?? [], url),
        ...findEntryUsages(
          entries.data ?? [],
          url,
          Object.fromEntries((collections.data ?? []).map((c) => [c.id as string, c.name_singular as string])),
        ),
      ];

      return toolTextResult({
        used: usages.length > 0,
        live_usages: usages.filter((u) => u.isLive).length,
        usages,
      });
    }

    default:
      return toolErrorResult(`Unknown tool: ${name}`);
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(rpcError(null, RPC_PARSE_ERROR, 'Invalid JSON.'), { status: 400 });
  }

  const parsed = parseRpcRequest(body);
  if (!parsed.ok) {
    return NextResponse.json(rpcError(null, RPC_INVALID_REQUEST, parsed.error), { status: 400 });
  }
  const { id, method, params } = parsed.request;

  const supabase = createAdminClient();
  const ctx = await resolveKey(req, supabase);
  if (!ctx) {
    // 401 with a WWW-Authenticate hint, so a client knows to attach a key
    // rather than assuming the server is broken.
    return NextResponse.json(rpcError(id, RPC_INVALID_REQUEST, 'A valid API key is required.'), {
      status: 401,
      headers: { 'WWW-Authenticate': 'Bearer realm="ne-website-manager"' },
    });
  }

  try {
    switch (method) {
      case 'initialize':
        return NextResponse.json(
          rpcResult(id, {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: MCP_SERVER_INFO,
            instructions:
              `You are connected to the Neu Entity CMS for ${ctx.clientName}. ` +
              'You can read content and write drafts. You cannot publish, unpublish or delete — ' +
              'a person does that in the CMS. When you change a published entry, say so plainly, ' +
              'because the website will not show your change until someone publishes it.',
          }),
        );

      case 'notifications/initialized':
        // A notification carries no id and expects no body.
        return new NextResponse(null, { status: 202 });

      case 'tools/list':
        return NextResponse.json(
          rpcResult(id, {
            tools: MCP_TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
          }),
        );

      case 'tools/call': {
        const name = params.name;
        if (typeof name !== 'string') {
          return NextResponse.json(rpcError(id, RPC_INVALID_PARAMS, 'params.name is required.'));
        }
        if (!findTool(name)) {
          return NextResponse.json(rpcError(id, RPC_INVALID_PARAMS, `Unknown tool: ${name}`));
        }
        const args = (params.arguments ?? {}) as Record<string, unknown>;
        return NextResponse.json(rpcResult(id, await callTool(name, args, ctx, supabase)));
      }

      default:
        if (isNotification(body)) return new NextResponse(null, { status: 202 });
        return NextResponse.json(rpcError(id, RPC_METHOD_NOT_FOUND, `Unsupported method: ${method}`));
    }
  } catch (error) {
    console.error('MCP request failed', method, error);
    return NextResponse.json(rpcError(id, RPC_INTERNAL_ERROR, 'The request could not be completed.'), {
      status: 500,
    });
  }
}
