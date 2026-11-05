/**
 * The tools this CMS exposes to an AI agent over MCP.
 *
 * ## Why this exists
 *
 * Every bulk content job NE will ever need — backfill the missing search
 * descriptions for a client, find what uses a media file, migrate the
 * properties into a collection, check what is broken across every site — is
 * currently either a bespoke UI screen or nothing. A screen is the right
 * answer when the user is a mosque administrator doing one thing carefully.
 * It is the wrong answer when the user is the operator doing forty things
 * at once, and building one per job is why those jobs do not get done.
 *
 * ## The safety posture: drafts in, publishing stays human
 *
 * No tool here can publish, unpublish, or delete. Writes set draft content
 * only, and a person still presses the button that puts it on a website.
 * That is a deliberate boundary rather than a limitation: migrations 015 and
 * 016 exist because publishing is the operation this codebase has repeatedly
 * had to defend, and handing an agent the ability to bypass the editor's own
 * publish path would undo that work from the outside.
 *
 * Authorization is the existing per-client API key (`api_keys`, migration
 * 004) — the same credential a client website uses, with the same revocation
 * and the same tenant scoping. There is no new secret and no new trust
 * boundary.
 *
 * ## Definitions live here, execution lives in the route
 *
 * Keeping the schemas pure means they can be asserted in tests without a
 * database or a transport, which is what stops a tool's description drifting
 * from what it actually does — the single most common way an agent is
 * misled.
 */

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
    additionalProperties: false;
  };
  /** True when the tool changes stored content. Used to gate and to log. */
  mutates: boolean;
}

export const MCP_PROTOCOL_VERSION = '2025-06-18';

export const MCP_SERVER_INFO = {
  name: 'ne-website-manager',
  version: '1.0.0',
} as const;

/**
 * Descriptions are written prescriptively — when to call the tool, not just
 * what it does — because that is what actually moves an agent's should-call
 * rate. Each one also states the safety boundary in its own text, so an
 * agent planning a publish does not have to discover the limitation by
 * getting an error.
 */
export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'list_collections',
    description:
      'List this website\'s content collections and their field schemas. Call this first when you need to know what content types exist, what fields an entry has, or which key holds a particular value — every other content tool needs a collection id or a field key from here.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    mutates: false,
  },
  {
    name: 'list_entries',
    description:
      'List entries in a collection, newest first. Call this to survey content before changing it, to find entries matching a status, or to get the entry ids the other tools need. Returns entry data, so prefer a status filter over fetching everything.',
    inputSchema: {
      type: 'object',
      properties: {
        collection_id: { type: 'string', description: 'From list_collections.' },
        status: {
          type: 'string',
          description: 'Filter by publication state. Omit for all.',
          enum: ['draft', 'published', 'archived'],
        },
        limit: { type: 'number', description: 'Max entries to return, 1-200. Defaults to 50.' },
      },
      required: ['collection_id'],
      additionalProperties: false,
    },
    mutates: false,
  },
  {
    name: 'update_entry_draft',
    description:
      'Set field values on a single entry WITHOUT publishing it. Call this to fix or backfill content — for example writing missing search descriptions. Only the keys you pass are changed; everything else is left alone. This never publishes: a published entry keeps serving its current content to the website until a person publishes the change in the CMS.',
    inputSchema: {
      type: 'object',
      properties: {
        entry_id: { type: 'string', description: 'From list_entries.' },
        data: {
          type: 'object',
          description: 'Field keys to set, from the collection schema. Merged into existing data.',
        },
      },
      required: ['entry_id', 'data'],
      additionalProperties: false,
    },
    mutates: true,
  },
  {
    name: 'find_content_gaps',
    description:
      'Report what is wrong with the website as visitors see it right now: pages missing search descriptions, pictures with no description, internal links that go nowhere, uploads nothing uses, and updates that failed to reach the live site. Call this to decide what work is worth doing before changing anything.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    mutates: false,
  },
  {
    name: 'find_media_usage',
    description:
      'Show every post, page and entry that references a media file, and whether each is live. Call this BEFORE suggesting a file be deleted — the answer is frequently "a published page uses it".',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The media file URL to search for.' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    mutates: false,
  },
];

export function findTool(name: string): McpToolDefinition | undefined {
  return MCP_TOOLS.find((tool) => tool.name === name);
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 envelope
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  /**
   * Always present after `parseRpcRequest` — a notification's absent id is
   * normalised to `null` there, so callers never have to narrow `undefined`
   * before answering.
   */
  id: string | number | null;
  method: string;
  params: Record<string, unknown>;
}

export type JsonRpcResponse =
  | { jsonrpc: '2.0'; id: string | number | null; result: unknown }
  | { jsonrpc: '2.0'; id: string | number | null; error: { code: number; message: string } };

/** Standard JSON-RPC codes, plus the one MCP adds for an unknown tool. */
export const RPC_PARSE_ERROR = -32700;
export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INVALID_PARAMS = -32602;
export const RPC_INTERNAL_ERROR = -32603;

export function rpcError(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

export function rpcResult(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

/**
 * Validates the envelope before anything reads `params`.
 *
 * A notification (no `id`) is legal JSON-RPC and means "no response
 * expected" — MCP sends `notifications/initialized` after the handshake, and
 * a server that answers it with an error confuses well-behaved clients.
 */
export function parseRpcRequest(body: unknown): { ok: true; request: JsonRpcRequest } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) return { ok: false, error: 'Request must be a JSON object.' };
  const candidate = body as Record<string, unknown>;
  if (candidate.jsonrpc !== '2.0') return { ok: false, error: 'jsonrpc must be "2.0".' };
  if (typeof candidate.method !== 'string' || candidate.method === '') {
    return { ok: false, error: 'method is required.' };
  }
  const id = candidate.id;
  if (id !== undefined && id !== null && typeof id !== 'string' && typeof id !== 'number') {
    return { ok: false, error: 'id must be a string, a number, or null.' };
  }
  return {
    ok: true,
    request: {
      jsonrpc: '2.0',
      id: (id ?? null) as string | number | null,
      method: candidate.method,
      params: (candidate.params ?? {}) as Record<string, unknown>,
    },
  };
}

export function isNotification(body: unknown): boolean {
  return typeof body === 'object' && body !== null && !('id' in (body as Record<string, unknown>));
}

/** MCP tool results are content blocks; text is the only kind used here. */
export function toolTextResult(payload: unknown): { content: { type: 'text'; text: string }[] } {
  return {
    content: [{ type: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }],
  };
}

export function toolErrorResult(message: string): { content: { type: 'text'; text: string }[]; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/** Clamps a caller-supplied limit into a range a single response can carry. */
export function clampLimit(value: unknown, fallback = 50, max = 200): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}
