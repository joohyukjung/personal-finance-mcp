# Personal Finance MCP Server

A comprehensive Model Context Protocol (MCP) server for personal finance and budget management. Track expenses, manage budgets, monitor financial goals, and gain insights into your spending patterns through AI assistants.

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

## 🎨 Premium Features

This is a **freemium** MCP server. Basic functionality is free, with premium features available:

### Free Tier
- ✅ Up to 100 transactions per month
- ✅ 5 budget categories
- ✅ 3 financial goals
- ✅ Basic spending summaries
- ✅ Single account

### Premium Tier ($12/month)
- 🚀 Unlimited transactions and accounts
- 🚀 Advanced analytics with trend forecasting
- 🚀 Custom reporting and data export
- 🚀 Goal achievement insights and recommendations
- 🚀 Multi-currency support
- 🚀 Automated transaction categorization
- 🚀 Integration with bank APIs (planned)

## 📦 Installation

```bash
npm install @leviai/personal-finance-mcp
```

Or run directly:
```bash
npx @leviai/personal-finance-mcp
```

## 🔧 Setup

### Claude Desktop
Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "personal-finance": {
      "command": "npx",
      "args": ["@leviai/personal-finance-mcp"]
    }
  }
}
```

### Cursor IDE
Add to your MCP settings:

```json
{
  "personal-finance": {
    "command": "npx",
    "args": ["@leviai/personal-finance-mcp"]
  }
}
```

## 💡 Usage Examples

### Record a Transaction
```
Add a $50 expense for groceries at Whole Foods to my main account
```

### Check Budget Status
```
Show me my budget status for this month
```

### Set a Financial Goal
```
Create a vacation fund goal of $3000 by December 2024
```

### Analyze Spending
```
Analyze my spending patterns for the last 6 months
```

### Get Monthly Summary
```
Show me my income vs expenses for this month
```

## 🗄️ Data Storage

All financial data is stored locally in SQLite (`finance.db`). The database includes:

- **transactions** - Income and expense records
- **budgets** - Monthly spending limits by category
- **financial_goals** - Savings and spending targets
- **accounts** - Multiple account management

## 🔐 Privacy & Security

- 🔒 **100% Local**: All data stays on your machine
- 🚫 **No Cloud Sync**: No data transmitted to external servers
- 🗂️ **Portable**: Easily backup or migrate your `finance.db` file
- 🛡️ **Open Source**: Full transparency of data handling

## 🏗️ Architecture

Built with modern Node.js and MCP SDK:
- **Runtime**: Node.js 18+
- **Protocol**: Model Context Protocol 1.0
- **Database**: SQLite3 for reliability and portability
- **Transport**: stdio (standard in Claude Desktop, Cursor)

## 🤝 Contributing

This is part of the @leviai MCP server ecosystem. Contributions welcome!

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details

## 🌟 Why This Exists

Personal finance management is broken in AI assistants. Existing tools are either:
- Too basic (just expense tracking)
- Too complex (enterprise accounting software)
- Privacy-invasive (cloud-first with data mining)

This MCP server bridges the gap, providing comprehensive personal finance tools that work seamlessly with AI assistants while keeping your data completely private.

## 🔮 Roadmap

- [ ] Bank API integrations for automatic transaction import
- [ ] Multi-currency support
- [ ] Advanced forecasting and trend analysis  
- [ ] Bill reminder and recurring transaction tracking
- [ ] Investment portfolio tracking
- [ ] Tax preparation assistance
- [ ] Financial health scoring

---

**Built by Levi AI** | [GitHub](https://github.com/leviai/personal-finance-mcp) | [Support](mailto:support@leviai.dev)