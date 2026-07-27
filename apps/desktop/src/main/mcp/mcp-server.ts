/**
 * The local MCP (Model Context Protocol) server: how external AI tools
 * (Claude Code, Cursor, Claude Desktop, …) connect to Space and see its
 * workspaces, projects, and repository state instead of working blind.
 *
 * Security posture (this is a brand-new caller surface — the renderer's
 * `assertIpcSender` gate does not apply to HTTP callers, so this file is
 * the equivalent gate for them):
 *  - Off by default; an explicit opt-in via the app menu
 *    (`appSettings.isMcpServerEnabled`, same posture as telemetry).
 *  - Binds 127.0.0.1 only — never reachable off-machine.
 *  - Every request must present a bearer token generated on this machine
 *    and stored under userData with owner-only permissions. A browser page
 *    cannot attach that header cross-site without a CORS preflight we
 *    never grant, and the transport's DNS-rebinding protection
 *    (allowedHosts) rejects spoofed Host headers.
 *  - The tool surface itself is the read-only registry in
 *    tool-registry.ts; nothing here can mutate a repository or spawn a
 *    process.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server as NodeHttpServer, type ServerResponse } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Logger } from '@space/logging';
import { MCP_TOOLS, runMcpTool, type McpToolDeps } from './tool-registry';

export const DEFAULT_MCP_PORT = 4923;
const MCP_PATH = '/mcp';
const TOKEN_FILE = 'auth-token';
const CONNECTION_FILE = 'connection.json';

export interface McpServerOptions {
  readonly deps: McpToolDeps;
  readonly logger: Logger;
  /** userData-scoped directory for the auth token + connection info (e.g. `<userData>/mcp`). */
  readonly dataDir: string;
  readonly appVersion: string;
  readonly port?: number;
}

export interface McpServerHandle {
  readonly url: string;
  stop(): Promise<void>;
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Constant-time comparison over digests so unequal lengths never throw and never short-circuit. */
function tokenMatches(presented: string, expected: string): boolean {
  return timingSafeEqual(sha256(presented), sha256(expected));
}

/**
 * The machine-local bearer token, created on first use. Exported because the
 * "connect an AI tool" flow (ai-tool-handlers.ts) needs to write it into that
 * tool's own config, and must get the same token this server will accept —
 * including before the server has ever been started.
 */
export async function ensureMcpToken(dataDir: string): Promise<string> {
  const tokenPath = path.join(dataDir, TOKEN_FILE);
  try {
    const existing = (await fs.readFile(tokenPath, 'utf8')).trim();
    if (existing.length >= 32) {
      return existing;
    }
  } catch {
    // Fall through to (re)create.
  }
  const token = randomBytes(32).toString('hex');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(tokenPath, `${token}\n`, { mode: 0o600 });
  return token;
}

/**
 * A copy-pasteable connection recipe written next to the token, so
 * "connect your AI tool to Space" is: open this file, paste the command.
 */
async function writeConnectionFile(dataDir: string, url: string, token: string): Promise<void> {
  const connection = {
    transport: 'http',
    url,
    headers: { Authorization: `Bearer ${token}` },
    claudeCode: `claude mcp add --transport http space ${url} --header "Authorization: Bearer ${token}"`,
    note: 'Local-only MCP server for the Space desktop app. Treat this file like a credential.',
  };
  await fs.writeFile(path.join(dataDir, CONNECTION_FILE), `${JSON.stringify(connection, null, 2)}\n`, { mode: 0o600 });
}

function buildProtocolServer(deps: McpToolDeps, appVersion: string): Server {
  const server = new Server(
    { name: 'space', version: appVersion },
    {
      capabilities: { tools: {} },
      instructions:
        'Space routes context by codebase path, never by whichever workspace is visible in the Space window. At the start of every coding session, call get_project_context with the absolute current working-directory path. If the working directory or codebase changes, call get_project_context again before any other Space tool and use only the projectId returned for that path. Do not reuse a projectId across codebases.',
    },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: MCP_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: z.toJSONSchema(tool.inputSchema) as { type: 'object'; [key: string]: unknown },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const result = await runMcpTool(deps, request.params.name, request.params.arguments ?? {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (error) {
      // Tool failures (unknown project id, invalid input, git errors) are
      // results for the calling model to read, not protocol errors.
      const message = error instanceof Error ? error.message : String(error);
      return { isError: true, content: [{ type: 'text', text: message }] };
    }
  });
  return server;
}

export async function startMcpServer(options: McpServerOptions): Promise<McpServerHandle> {
  const { deps, logger, dataDir, appVersion } = options;
  const port = options.port ?? DEFAULT_MCP_PORT;
  const url = `http://127.0.0.1:${port}${MCP_PATH}`;
  const token = await ensureMcpToken(dataDir);

  // Each request gets a fresh stateless transport + protocol server pair
  // (the SDK's documented stateless mode); live ones are tracked only so
  // stop() can drop in-flight SSE streams.
  const liveTransports = new Set<StreamableHTTPServerTransport>();

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if ((req.url ?? '').split('?')[0] !== MCP_PATH) {
      res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'not found' }));
      return;
    }
    const authorization = req.headers.authorization ?? '';
    const presented = authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length).trim() : '';
    if (!presented || !tokenMatches(presented, token)) {
      logger.warn('MCP request rejected: missing or invalid bearer token');
      res.writeHead(401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    // No `sessionIdGenerator` key at all — the transport reads its absence
    // as stateless mode (a fresh transport per request). `exactOptionalPropertyTypes`
    // forbids passing the key as an explicit `undefined`, so we omit it.
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts: [`127.0.0.1:${port}`, `localhost:${port}`],
    });
    const protocolServer = buildProtocolServer(deps, appVersion);
    liveTransports.add(transport);
    res.on('close', () => {
      liveTransports.delete(transport);
      void transport.close();
      void protocolServer.close();
    });
    // The SDK's own Transport interface trips exactOptionalPropertyTypes even
    // though StreamableHTTPServerTransport implements it; narrow through it.
    await protocolServer.connect(transport as Transport);
    await transport.handleRequest(req, res);
  }

  const httpServer: NodeHttpServer = createServer((req, res) => {
    void handle(req, res).catch((error: unknown) => {
      logger.error('MCP request failed', { error: error instanceof Error ? error.message : String(error) });
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'internal error' }));
      } else {
        res.end();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, '127.0.0.1', () => {
      httpServer.removeListener('error', reject);
      resolve();
    });
  });

  await writeConnectionFile(dataDir, url, token);
  logger.info('MCP server listening', { url, tools: MCP_TOOLS.length, connectionFile: path.join(dataDir, CONNECTION_FILE) });

  return {
    url,
    async stop(): Promise<void> {
      for (const transport of liveTransports) {
        void transport.close();
      }
      liveTransports.clear();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await fs.rm(path.join(dataDir, CONNECTION_FILE), { force: true });
      logger.info('MCP server stopped');
    },
  };
}
