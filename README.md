# debug-mcp-server

A minimal [Model Context Protocol](https://modelcontextprotocol.io) server for debugging MCP clients. It echoes back everything it receives — tool arguments, session IDs, metadata — so you can inspect exactly what your client is sending.

Uses **Streamable HTTP** transport (no stdio).

## Tools

| Tool | Description |
|---|---|
| `debug_echo` | Returns all passed arguments as JSON along with `sessionId` and `_meta` |
| `debug_inspect` | Recursively prints the type and structure of any value |
| `debug_server_info` | Returns Node.js version, platform, uptime, memory usage |

## Requirements

- Node.js 18+

## Installation

```bash
git clone https://github.com/your-username/debug-mcp-server.git
cd debug-mcp-server
npm install
```

## Usage

```bash
npm start
# Server listening on http://127.0.0.1:3000/mcp
```

Environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `HOST` | `127.0.0.1` | Host to bind to |

## Connect to Claude Code

```bash
claude mcp add --transport http debug-mcp-server http://127.0.0.1:3000/mcp
```

## API

All requests go to `POST /mcp`. The session lifecycle follows the [MCP Streamable HTTP spec](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports#streamable-http):

1. **Initialize** — send an `initialize` request without `mcp-session-id`; the server responds with the header `mcp-session-id`
2. **Subsequent requests** — include `mcp-session-id` in every request
3. **SSE stream** — `GET /mcp` with `mcp-session-id` opens a server-sent events stream for server→client notifications
4. **Terminate** — `DELETE /mcp` with `mcp-session-id` closes the session

Every incoming request (headers + body) is logged to stdout.

### Example session

```bash
# 1. Initialize
curl -sD - -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0", "id": 1, "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": { "name": "test", "version": "1.0" }
    }
  }'
# → header: mcp-session-id: <SESSION_ID>

# 2. Call debug_echo
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "mcp-session-id: <SESSION_ID>" \
  -d '{
    "jsonrpc": "2.0", "id": 2, "method": "tools/call",
    "params": {
      "name": "debug_echo",
      "arguments": { "message": "hello", "number": 42, "flag": true }
    }
  }'
```

Response from `debug_echo`:

```json
{
  "tool": "debug_echo",
  "timestamp": "2026-06-23T10:56:52.842Z",
  "params": {
    "message": "hello",
    "number": 42,
    "flag": true
  },
  "meta": null,
  "sessionId": "<SESSION_ID>"
}
```

## License

MIT
