# Personal Finance MCP Server

A comprehensive Model Context Protocol (MCP) server for personal finance and budget management. Track expenses, manage budgets, monitor financial goals, and gain insights into your spending patterns through AI assistants.

> This fork adds a stateless `streamable-http` transport and Docker support for remote/gateway deployments, in addition to the original stdio mode. See [HTTP / Docker Deployment](#-http--docker-deployment) below.

## 🚀 Features

### 6 Powerful Tools

1. **add_transaction** - Record income and expenses with categorization
2. **get_spending_summary** - Analyze spending patterns by time period and category
3. **manage_budget** - Create and track monthly budget limits with overspend alerts
4. **track_financial_goal** - Set and monitor progress toward financial goals
5. **analyze_spending_patterns** - Deep insights into spending behavior and trends
6. **manage_accounts** - Handle multiple accounts (checking, savings, credit, etc.)

### Key Capabilities

- 💰 **Transaction Management**: Record income and expenses with rich metadata
- 📊 **Budget Tracking**: Set monthly limits and get real-time budget alerts
- 🎯 **Goal Setting**: Track progress toward savings and financial milestones
- 📈 **Smart Analytics**: Monthly trends, category breakdowns, and spending insights
- 💳 **Multi-Account Support**: Manage checking, savings, credit, investment accounts
- 🔒 **Local Data**: All data stored locally in SQLite - complete privacy

## 🎨 Pricing Note

The upstream project describes this as a **freemium** server with a $12/month premium tier (unlimited transactions/accounts, advanced analytics, multi-currency, etc.). As of this fork, **no license check, payment gating, or usage limiting is implemented in code** — all 6 tools run fully unrestricted regardless of tier. Treat the free/premium tier descriptions as aspirational/marketing text only.

## 📦 Installation

```bash
npm install
```

## 🔧 Setup

### Claude Desktop (stdio)
Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "personal-finance": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/personal-finance-mcp/src/index.js"],
      "env": {
        "FINANCE_DB_PATH": "/ABSOLUTE/PATH/TO/finance.db"
      }
    }
  }
}
```

## 🌐 HTTP / Docker Deployment

For remote/gateway use (e.g. an MCP hub), this fork ships an Express-based HTTP bridge (`src/http-server.js`) using `StreamableHTTPServerTransport`, stateless (no session ID required — each request is handled independently).

### Docker

```bash
docker build --platform linux/amd64 -t personal-finance-mcp .
docker run -d -p 8000:8000 \
  -e FINANCE_DB_PATH=/data/finance.db \
  -v $(pwd)/data:/data \
  personal-finance-mcp
```

The server listens on `POST /mcp` (JSON-RPC 2.0, `Accept: application/json, text/event-stream`) and exposes `GET /health` for liveness checks.

### Running the HTTP bridge directly

```bash
FINANCE_DB_PATH=/path/to/finance.db PORT=8000 node src/http-server.js
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `FINANCE_DB_PATH` | No | SQLite file path (default: `./finance.db` in the working directory). Set this to a mounted volume path for persistence across container restarts. |
| `PORT` | No | HTTP port for `streamable-http` mode (default: `8000`) |

## 💡 Usage Examples

### Record a Transaction