#!/usr/bin/env node
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { PersonalFinanceServer, initDatabase } from "./index.js";

const PORT = Number(process.env.PORT ?? 8000);

await initDatabase();

// PersonalFinanceServer는 세션별 상태가 없고(모든 상태는 SQLite DB 파일에 저장됨),
// 내부 Server 인스턴스만 하나 공유하면 되므로 프로세스 시작 시 한 번만 생성.
// StreamableHTTPServerTransport는 요청마다 새로 생성한다 (horoscope-mcp/fit-mcp/
// food-tracker-mcp 등에서 확인된 패턴: 트랜스포트를 프로세스 시작 시 한 번만 만들어
// 공유하면 두 번째 요청부터 응답이 비어버림).
const financeServer = new PersonalFinanceServer();

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
});

app.post("/mcp", async (req, res) => {
    try {
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableDnsRebindingProtection: false,
        });
        res.on("close", () => {
            transport.close();
        });
        await financeServer.server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    } catch (error) {
        console.error("MCP request error:", error instanceof Error ? error.message : String(error));
        if (!res.headersSent) {
            res.status(500).json({ error: "internal_error" });
        }
    }
});

app.listen(PORT, () => {
    console.error(`personal-finance-mcp HTTP server listening on :${PORT}`);
});