// The part of the Model Context Protocol this server needs, by hand: JSON-RPC 2.0 messages, one
// per line, with initialize, ping, tools/list and tools/call. The SDK would bring about 90
// packages (HTTP servers, CORS, a JSON Schema validator) for a stdio server with two tools.

export type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  // A tool may wait, as `ask` does on a search and a model.
  call: (args: Record<string, unknown>) => string | Promise<string>;
};

type Message = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
export type Response = { jsonrpc: '2.0'; id: string | number | null } & (
  | { result: unknown }
  | { error: { code: number; message: string } }
);

// Newest first; a client asking for one of these gets it back, any other gets the newest.
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

// A tool's own failure (bad arguments, nothing indexed) is a result with isError, which the model
// reads; a protocol failure is a JSON-RPC error.
export class ToolError extends Error {}

export function createHandler(
  server: { name: string; version: string },
  tools: Tool[],
): (line: string) => Promise<Response | undefined> {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const ok = (id: Response['id'], result: unknown): Response => ({ jsonrpc: '2.0', id, result });
  const fail = (id: Response['id'], code: number, message: string): Response => ({
    jsonrpc: '2.0',
    id,
    error: { code, message },
  });

  return async (line) => {
    let msg: Message;
    try {
      msg = JSON.parse(line) as Message;
    } catch {
      return fail(null, -32700, 'parse error');
    }
    // A notification (no id) is never answered, initialized included.
    if (msg.id === undefined) return undefined;
    const id = msg.id;
    switch (msg.method) {
      case 'initialize': {
        const asked = msg.params?.protocolVersion;
        const protocolVersion =
          typeof asked === 'string' && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0];
        return ok(id, { protocolVersion, capabilities: { tools: {} }, serverInfo: server });
      }
      case 'ping':
        return ok(id, {});
      case 'tools/list':
        return ok(id, {
          tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
        });
      case 'tools/call': {
        const tool = byName.get(String(msg.params?.name));
        if (tool === undefined) return fail(id, -32602, `unknown tool ${String(msg.params?.name)}`);
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
        try {
          return ok(id, { content: [{ type: 'text', text: await tool.call(args) }] });
        } catch (e) {
          if (!(e instanceof ToolError)) throw e;
          return ok(id, { content: [{ type: 'text', text: e.message }], isError: true });
        }
      }
      default:
        return fail(id, -32601, `method not found: ${String(msg.method)}`);
    }
  };
}
