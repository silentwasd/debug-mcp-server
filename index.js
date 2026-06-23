import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { z } from "zod";

const PORT = process.env.PORT ?? 3000;
const HOST = process.env.HOST ?? "127.0.0.1";

// Фабрика — каждая сессия получает свой экземпляр McpServer
function createServer() {
  const server = new McpServer({ name: "debug-mcp-server", version: "1.0.0" });

  // Возвращает все переданные параметры + заголовки запроса
  server.tool(
    "debug_echo",
    "Возвращает все переданные параметры для отладки",
    {
      message: z.string().optional().describe("Любое текстовое сообщение"),
      data: z.record(z.unknown()).optional().describe("Произвольный объект"),
      number: z.number().optional().describe("Числовой параметр"),
      flag: z.boolean().optional().describe("Булев параметр"),
      items: z.array(z.unknown()).optional().describe("Массив элементов"),
    },
    async (params, extra) => ({
      content: [{
        type: "text",
        text: JSON.stringify({
          tool: "debug_echo",
          timestamp: new Date().toISOString(),
          params,
          meta: extra?._meta ?? null,
          sessionId: extra?.sessionId ?? null,
        }, null, 2),
      }],
    })
  );

  // Инспектирует тип и структуру произвольного значения
  server.tool(
    "debug_inspect",
    "Детально инспектирует переданный аргумент с типами",
    { value: z.unknown().describe("Любое значение для инспекции") },
    async ({ value }) => {
      const inspect = (val, depth = 0) => {
        const pad = "  ".repeat(depth);
        if (val === null) return `${pad}null`;
        if (val === undefined) return `${pad}undefined`;
        const t = typeof val;
        if (t !== "object") return `${pad}(${t}) ${JSON.stringify(val)}`;
        if (Array.isArray(val)) {
          const rows = val.map((v, i) => `${pad}  [${i}]: ${inspect(v, depth + 1).trimStart()}`);
          return `${pad}(array[${val.length}])\n${rows.join("\n")}`;
        }
        const rows = Object.entries(val).map(
          ([k, v]) => `${pad}  "${k}": ${inspect(v, depth + 1).trimStart()}`
        );
        return `${pad}(object)\n${rows.join("\n")}`;
      };

      return {
        content: [{
          type: "text",
          text: `=== debug_inspect ===\n${inspect(value)}\n\nJSON:\n${JSON.stringify(value, null, 2)}`,
        }],
      };
    }
  );

  // Информация о сервере и Node.js окружении
  server.tool(
    "debug_server_info",
    "Возвращает информацию о сервере и среде выполнения",
    {},
    async (_p, extra) => ({
      content: [{
        type: "text",
        text: JSON.stringify({
          server: { name: "debug-mcp-server", version: "1.0.0" },
          node: { version: process.version, platform: process.platform, arch: process.arch },
          uptime_seconds: process.uptime(),
          memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          sessionId: extra?.sessionId ?? null,
        }, null, 2),
      }],
    })
  );

  return server;
}

// Хранилище активных транспортов по sessionId
const transports = new Map();

const app = createMcpExpressApp({ host: HOST });

// Добавляем логирование всех входящих запросов
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  console.log("  Headers:", JSON.stringify(req.headers, null, 4));
  if (req.body && Object.keys(req.body).length) {
    console.log("  Body:", JSON.stringify(req.body, null, 4));
  }
  next();
});

app.post("/mcp", async (req, res) => {
  try {
    const sessionId = req.headers["mcp-session-id"];
    let transport = sessionId ? transports.get(sessionId) : null;

    if (transport) {
      // Продолжаем существующую сессию
      await transport.handleRequest(req, res, req.body);
      return;
    }

    if (!sessionId && isInitializeRequest(req.body)) {
      // Новая сессия
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          console.log(`[session] initialized: ${sid}`);
          transports.set(sid, transport);
        },
      });

      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) {
          console.log(`[session] closed: ${sid}`);
          transports.delete(sid);
        }
      };

      await createServer().connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: No valid session ID provided" },
      id: null,
    });
  } catch (err) {
    console.error("[error]", err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// SSE-стрим для сервер→клиент нотификаций
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  const transport = sessionId ? transports.get(sessionId) : null;

  if (!transport) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Bad Request: No valid session ID provided" },
      id: null,
    });
    return;
  }

  await transport.handleRequest(req, res);
});

app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"];
  const transport = sessionId ? transports.get(sessionId) : null;

  if (!transport) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  await transport.handleRequest(req, res);
});

app.listen(PORT, HOST, () => {
  console.log(`[debug-mcp-server] listening on http://${HOST}:${PORT}/mcp`);
});

process.on("SIGINT", () => {
  console.log("\n[debug-mcp-server] shutting down");
  process.exit(0);
});
