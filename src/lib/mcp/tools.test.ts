import { describe, expect, it } from 'vitest';
import {
  MCP_TOOLS,
  clampLimit,
  findTool,
  isNotification,
  parseRpcRequest,
  rpcError,
  rpcResult,
  toolErrorResult,
  toolTextResult,
} from './tools';

describe('the exposed tool set', () => {
  it('exposes no tool that can publish, unpublish or delete', () => {
    // The safety boundary of the whole endpoint. If a future tool named
    // `publish_entry` or `delete_media` is added, this fails first.
    const forbidden = /publish|unpublish|delete|archive|remove|destroy/i;
    for (const tool of MCP_TOOLS) {
      expect(tool.name).not.toMatch(forbidden);
    }
  });

  it('has exactly one mutating tool, and it writes drafts', () => {
    const mutating = MCP_TOOLS.filter((t) => t.mutates);
    expect(mutating.map((t) => t.name)).toEqual(['update_entry_draft']);
  });

  it('tells an agent in the tool text that publishing stays human', () => {
    // An agent should learn the limit from the description, not from an
    // error after it has already planned a publish.
    const update = findTool('update_entry_draft');
    expect(update?.description).toMatch(/never publishes/i);
    expect(update?.description).toMatch(/until a person publishes/i);
  });

  it('describes when to call each tool, not only what it does', () => {
    // Prescriptive descriptions are what actually move an agent's
    // should-call rate.
    for (const tool of MCP_TOOLS) {
      expect(tool.description).toMatch(/call this/i);
    }
  });

  it('gives every tool a closed input schema', () => {
    for (const tool of MCP_TOOLS) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  it('describes every parameter it accepts', () => {
    for (const tool of MCP_TOOLS) {
      for (const [key, prop] of Object.entries(tool.inputSchema.properties)) {
        expect(prop.description, `${tool.name}.${key}`).toBeTruthy();
      }
    }
  });

  it('has unique tool names', () => {
    expect(new Set(MCP_TOOLS.map((t) => t.name)).size).toBe(MCP_TOOLS.length);
  });

  it('warns against deleting media before checking usage', () => {
    expect(findTool('find_media_usage')?.description).toMatch(/before/i);
  });
});

describe('parseRpcRequest', () => {
  it('accepts a well-formed call', () => {
    const result = parseRpcRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request.method).toBe('tools/list');
      expect(result.request.id).toBe(1);
      expect(result.request.params).toEqual({});
    }
  });

  it('normalises a notification\'s absent id to null', () => {
    // So the route never has to narrow `undefined` before answering.
    const result = parseRpcRequest({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.request.id).toBeNull();
  });

  it('rejects a wrong or missing protocol version', () => {
    expect(parseRpcRequest({ jsonrpc: '1.0', method: 'x' }).ok).toBe(false);
    expect(parseRpcRequest({ method: 'x' }).ok).toBe(false);
  });

  it('rejects a missing or empty method', () => {
    expect(parseRpcRequest({ jsonrpc: '2.0', id: 1 }).ok).toBe(false);
    expect(parseRpcRequest({ jsonrpc: '2.0', id: 1, method: '' }).ok).toBe(false);
  });

  it('rejects an id that is neither a string, a number, nor null', () => {
    expect(parseRpcRequest({ jsonrpc: '2.0', id: {}, method: 'x' }).ok).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(parseRpcRequest(null).ok).toBe(false);
    expect(parseRpcRequest('tools/list').ok).toBe(false);
  });
});

describe('isNotification', () => {
  it('distinguishes a notification from a call', () => {
    // A notification expects no response body at all — answering one with an
    // error confuses well-behaved clients.
    expect(isNotification({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBe(true);
    expect(isNotification({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).toBe(false);
    expect(isNotification({ jsonrpc: '2.0', id: null, method: 'tools/list' })).toBe(false);
  });
});

describe('rpc envelopes', () => {
  it('shapes results and errors per JSON-RPC 2.0', () => {
    expect(rpcResult(7, { ok: true })).toEqual({ jsonrpc: '2.0', id: 7, result: { ok: true } });
    expect(rpcError(7, -32601, 'nope')).toEqual({
      jsonrpc: '2.0',
      id: 7,
      error: { code: -32601, message: 'nope' },
    });
  });
});

describe('tool results', () => {
  it('wraps a payload as an MCP text content block', () => {
    const result = toolTextResult({ a: 1 });
    expect(result.content[0].type).toBe('text');
    expect(JSON.parse(result.content[0].text)).toEqual({ a: 1 });
  });

  it('passes a string through without double-encoding it', () => {
    expect(toolTextResult('plain').content[0].text).toBe('plain');
  });

  it('flags an error result so the agent can react', () => {
    expect(toolErrorResult('bad').isError).toBe(true);
  });
});

describe('clampLimit', () => {
  it('bounds a caller-supplied limit to what one response can carry', () => {
    expect(clampLimit(500)).toBe(200);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(25)).toBe(25);
  });

  it('falls back for a missing or nonsensical value', () => {
    expect(clampLimit(undefined)).toBe(50);
    expect(clampLimit('lots')).toBe(50);
    expect(clampLimit(NaN)).toBe(50);
  });

  it('floors a fractional limit', () => {
    expect(clampLimit(10.9)).toBe(10);
  });
});
