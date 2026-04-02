#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import Database from 'sqlite3';
import { promisify } from 'util';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import fs from 'fs/promises';
import path from 'path';

// Database setup
const DB_PATH = process.env.FINANCE_DB_PATH || path.join(process.cwd(), 'finance.db');
let db;

async function initDatabase() {
  return new Promise((resolve, reject) => {
    db = new Database.Database(DB_PATH, async (err) => {
      if (err) {
        reject(err);
        return;
      }

      // Create tables
      const createTables = [
        `CREATE TABLE IF NOT EXISTS transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          date TEXT NOT NULL,
          amount REAL NOT NULL,
          category TEXT NOT NULL,
          description TEXT,
          account TEXT NOT NULL DEFAULT 'main',
          type TEXT CHECK(type IN ('income', 'expense')) NOT NULL,
          tags TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        
        `CREATE TABLE IF NOT EXISTS budgets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT UNIQUE NOT NULL,
          monthly_limit REAL NOT NULL,
          current_spent REAL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        
        `CREATE TABLE IF NOT EXISTS financial_goals (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          target_amount REAL NOT NULL,
          current_amount REAL DEFAULT 0,
          target_date TEXT,
          description TEXT,
          status TEXT CHECK(status IN ('active', 'completed', 'paused')) DEFAULT 'active',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        
        `CREATE TABLE IF NOT EXISTS accounts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          type TEXT CHECK(type IN ('checking', 'savings', 'credit', 'investment', 'cash')) NOT NULL,
          balance REAL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
      ];

      try {
        for (const sql of createTables) {
          await new Promise((resolve, reject) => {
            db.run(sql, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        }

        // Insert default account if none exist
        const countResult = await new Promise((resolve, reject) => {
          db.get("SELECT COUNT(*) as count FROM accounts", (err, row) => {
            if (err) reject(err);
            else resolve(row);
          });
        });

        if (countResult.count === 0) {
          await new Promise((resolve, reject) => {
            db.run("INSERT INTO accounts (name, type, balance) VALUES (?, ?, ?)", 
              ['main', 'checking', 0], (err) => {
                if (err) reject(err);
                else resolve();
              });
          });
        }

        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
}

// Helper function to run database queries
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

// Core financial calculations
function calculateBudgetProgress(spent, limit) {
  const percentage = (spent / limit) * 100;
  let status = 'good';
  if (percentage >= 100) status = 'over_budget';
  else if (percentage >= 80) status = 'warning';
  
  return {
    spent,
    limit,
    remaining: limit - spent,
    percentage: Math.round(percentage),
    status
  };
}

function calculateGoalProgress(current, target) {
  const percentage = (current / target) * 100;
  return {
    current,
    target,
    remaining: target - current,
    percentage: Math.round(percentage),
    completed: percentage >= 100
  };
}

async function updateBudgetSpending(category, amount) {
  const budget = await dbGet("SELECT * FROM budgets WHERE category = ?", [category]);
  if (budget) {
    const newSpent = budget.current_spent + amount;
    await dbRun("UPDATE budgets SET current_spent = ?, updated_at = CURRENT_TIMESTAMP WHERE category = ?", 
      [newSpent, category]);
  }
}

async function updateAccountBalance(account, amount, type) {
  const multiplier = type === 'income' ? 1 : -1;
  await dbRun("UPDATE accounts SET balance = balance + ? WHERE name = ?", 
    [amount * multiplier, account]);
}

class PersonalFinanceServer {
  constructor() {
    this.server = new Server(
      {
        name: 'personal-finance-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );
    this.setupToolHandlers();
  }

  setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'add_transaction',
            description: 'Add a new income or expense transaction',
            inputSchema: {
              type: 'object',
              properties: {
                amount: {
                  type: 'number',
                  description: 'Transaction amount (positive number)'
                },
                category: {
                  type: 'string',
                  description: 'Transaction category (e.g., food, rent, salary, entertainment)'
                },
                description: {
                  type: 'string',
                  description: 'Optional description of the transaction'
                },
                type: {
                  type: 'string',
                  enum: ['income', 'expense'],
                  description: 'Whether this is income or an expense'
                },
                account: {
                  type: 'string',
                  description: 'Account name (defaults to "main")',
                  default: 'main'
                },
                date: {
                  type: 'string',
                  description: 'Transaction date (YYYY-MM-DD format, defaults to today)'
                },
                tags: {
                  type: 'string',
                  description: 'Comma-separated tags for categorization'
                }
              },
              required: ['amount', 'category', 'type']
            }
          },
          {
            name: 'get_spending_summary',
            description: 'Get spending summary and analysis for a time period',
            inputSchema: {
              type: 'object',
              properties: {
                period: {
                  type: 'string',
                  enum: ['this_month', 'last_month', 'this_year', 'last_30_days', 'custom'],
                  description: 'Time period for the summary',
                  default: 'this_month'
                },
                start_date: {
                  type: 'string',
                  description: 'Start date for custom period (YYYY-MM-DD)'
                },
                end_date: {
                  type: 'string',
                  description: 'End date for custom period (YYYY-MM-DD)'
                },
                category: {
                  type: 'string',
                  description: 'Optional: filter by specific category'
                }
              }
            }
          },
          {
            name: 'manage_budget',
            description: 'Create, update, or view budget limits for categories',
            inputSchema: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  enum: ['create', 'update', 'view', 'delete'],
                  description: 'Budget management action'
                },
                category: {
                  type: 'string',
                  description: 'Budget category name'
                },
                monthly_limit: {
                  type: 'number',
                  description: 'Monthly spending limit for this category'
                }
              },
              required: ['action']
            }
          },
          {
            name: 'track_financial_goal',
            description: 'Create, update, or view progress on financial goals',
            inputSchema: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  enum: ['create', 'update', 'view', 'add_progress', 'delete'],
                  description: 'Goal management action'
                },
                name: {
                  type: 'string',
                  description: 'Goal name or identifier'
                },
                target_amount: {
                  type: 'number',
                  description: 'Target amount to reach'
                },
                current_amount: {
                  type: 'number',
                  description: 'Current progress amount'
                },
                target_date: {
                  type: 'string',
                  description: 'Target completion date (YYYY-MM-DD)'
                },
                description: {
                  type: 'string',
                  description: 'Goal description'
                },
                add_amount: {
                  type: 'number',
                  description: 'Amount to add to goal progress'
                }
              },
              required: ['action']
            }
          },
          {
            name: 'analyze_spending_patterns',
            description: 'Analyze spending patterns and provide insights',
            inputSchema: {
              type: 'object',
              properties: {
                analysis_type: {
                  type: 'string',
                  enum: ['monthly_trends', 'category_breakdown', 'budget_vs_actual', 'expense_insights'],
                  description: 'Type of analysis to perform',
                  default: 'monthly_trends'
                },
                months: {
                  type: 'number',
                  description: 'Number of months to analyze (default: 6)',
                  default: 6
                }
              }
            }
          },
          {
            name: 'manage_accounts',
            description: 'Manage financial accounts (checking, savings, credit cards, etc.)',
            inputSchema: {
              type: 'object',
              properties: {
                action: {
                  type: 'string',
                  enum: ['create', 'view', 'update', 'delete'],
                  description: 'Account management action'
                },
                name: {
                  type: 'string',
                  description: 'Account name'
                },
                type: {
                  type: 'string',
                  enum: ['checking', 'savings', 'credit', 'investment', 'cash'],
                  description: 'Account type'
                },
                balance: {
                  type: 'number',
                  description: 'Current account balance'
                }
              },
              required: ['action']
            }
          }
        ]
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'add_transaction':
            return await this.addTransaction(args);
          case 'get_spending_summary':
            return await this.getSpendingSummary(args);
          case 'manage_budget':
            return await this.manageBudget(args);
          case 'track_financial_goal':
            return await this.trackFinancialGoal(args);
          case 'analyze_spending_patterns':
            return await this.analyzeSpendingPatterns(args);
          case 'manage_accounts':
            return await this.manageAccounts(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`
            }
          ]
        };
      }
    });
  }

  async addTransaction(args) {
    const { amount, category, description = '', type, account = 'main', tags = '' } = args;
    const date = args.date || new Date().toISOString().split('T')[0];

    // Validate amount
    if (amount <= 0) {
      throw new Error('Amount must be positive');
    }

    // Insert transaction
    const result = await dbRun(
      "INSERT INTO transactions (date, amount, category, description, account, type, tags) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [date, amount, category, description, account, type, tags]
    );

    // Update budget if it's an expense
    if (type === 'expense') {
      await updateBudgetSpending(category, amount);
    }

    // Update account balance
    await updateAccountBalance(account, amount, type);

    // Get updated budget status
    let budgetStatus = '';
    if (type === 'expense') {
      const budget = await dbGet("SELECT * FROM budgets WHERE category = ?", [category]);
      if (budget) {
        const progress = calculateBudgetProgress(budget.current_spent, budget.monthly_limit);
        budgetStatus = ` | Budget: ${progress.percentage}% used (${progress.status})`;
      }
    }

    return {
      content: [
        {
          type: 'text',
          text: `✅ Transaction added successfully!\n\n📊 **Details:**\n- Amount: $${amount.toFixed(2)}\n- Type: ${type.toUpperCase()}\n- Category: ${category}\n- Account: ${account}\n- Date: ${date}${description ? `\n- Description: ${description}` : ''}${tags ? `\n- Tags: ${tags}` : ''}${budgetStatus}`
        }
      ]
    };
  }

  async getSpendingSummary(args) {
    const { period = 'this_month', start_date, end_date, category } = args;
    
    let dateFilter = '';
    let params = [];

    // Calculate date range
    const now = new Date();
    switch (period) {
      case 'this_month':
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        dateFilter = 'date >= ?';
        params.push(startOfMonth.toISOString().split('T')[0]);
        break;
      case 'last_month':
        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
        dateFilter = 'date >= ? AND date <= ?';
        params.push(lastMonth.toISOString().split('T')[0], endOfLastMonth.toISOString().split('T')[0]);
        break;
      case 'this_year':
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        dateFilter = 'date >= ?';
        params.push(startOfYear.toISOString().split('T')[0]);
        break;
      case 'last_30_days':
        const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
        dateFilter = 'date >= ?';
        params.push(thirtyDaysAgo.toISOString().split('T')[0]);
        break;
      case 'custom':
        if (!start_date || !end_date) {
          throw new Error('Custom period requires start_date and end_date');
        }
        dateFilter = 'date >= ? AND date <= ?';
        params.push(start_date, end_date);
        break;
    }

    let sql = `SELECT type, category, SUM(amount) as total, COUNT(*) as count FROM transactions WHERE ${dateFilter}`;
    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    sql += ' GROUP BY type, category ORDER BY total DESC';

    const summary = await dbAll(sql, params);

    // Calculate totals
    const income = summary.filter(s => s.type === 'income').reduce((sum, s) => sum + s.total, 0);
    const expenses = summary.filter(s => s.type === 'expense').reduce((sum, s) => sum + s.total, 0);
    const netIncome = income - expenses;

    // Format results
    let output = `💰 **Financial Summary (${period})**\n\n`;
    output += `📈 **Totals:**\n`;
    output += `- Income: $${income.toFixed(2)}\n`;
    output += `- Expenses: $${expenses.toFixed(2)}\n`;
    output += `- Net Income: $${netIncome.toFixed(2)} ${netIncome >= 0 ? '✅' : '⚠️'}\n\n`;

    if (summary.length > 0) {
      const incomeItems = summary.filter(s => s.type === 'income');
      const expenseItems = summary.filter(s => s.type === 'expense');

      if (incomeItems.length > 0) {
        output += `💵 **Income by Category:**\n`;
        incomeItems.forEach(item => {
          output += `- ${item.category}: $${item.total.toFixed(2)} (${item.count} transactions)\n`;
        });
        output += '\n';
      }

      if (expenseItems.length > 0) {
        output += `💸 **Expenses by Category:**\n`;
        expenseItems.forEach(item => {
          output += `- ${item.category}: $${item.total.toFixed(2)} (${item.count} transactions)\n`;
        });
      }
    } else {
      output += `No transactions found for the specified period.`;
    }

    return {
      content: [
        {
          type: 'text',
          text: output
        }
      ]
    };
  }

  async manageBudget(args) {
    const { action, category, monthly_limit } = args;

    switch (action) {
      case 'create':
        if (!category || monthly_limit == null) {
          throw new Error('Category and monthly_limit are required for creating a budget');
        }
        
        try {
          await dbRun("INSERT INTO budgets (category, monthly_limit) VALUES (?, ?)", 
            [category, monthly_limit]);
          return {
            content: [
              {
                type: 'text',
                text: `✅ Budget created for "${category}": $${monthly_limit.toFixed(2)}/month`
              }
            ]
          };
        } catch (error) {
          if (error.message.includes('UNIQUE constraint failed')) {
            throw new Error(`Budget for category "${category}" already exists. Use 'update' action to modify it.`);
          }
          throw error;
        }

      case 'update':
        if (!category || monthly_limit == null) {
          throw new Error('Category and monthly_limit are required for updating a budget');
        }
        
        const result = await dbRun("UPDATE budgets SET monthly_limit = ?, updated_at = CURRENT_TIMESTAMP WHERE category = ?", 
          [monthly_limit, category]);
        
        if (result.changes === 0) {
          throw new Error(`No budget found for category "${category}"`);
        }
        
        return {
          content: [
            {
              type: 'text',
              text: `✅ Budget updated for "${category}": $${monthly_limit.toFixed(2)}/month`
            }
          ]
        };

      case 'view':
        const budgets = await dbAll(
          category ? 
            "SELECT * FROM budgets WHERE category = ?" : 
            "SELECT * FROM budgets ORDER BY category",
          category ? [category] : []
        );

        if (budgets.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: category ? 
                  `No budget found for category "${category}"` : 
                  'No budgets have been created yet'
              }
            ]
          };
        }

        let output = category ? 
          `💰 **Budget for "${category}":**\n\n` : 
          `💰 **All Budgets:**\n\n`;

        for (const budget of budgets) {
          const progress = calculateBudgetProgress(budget.current_spent, budget.monthly_limit);
          const statusEmoji = progress.status === 'good' ? '✅' : 
                             progress.status === 'warning' ? '⚠️' : '🚨';
          
          output += `${statusEmoji} **${budget.category}**\n`;
          output += `- Limit: $${budget.monthly_limit.toFixed(2)}/month\n`;
          output += `- Spent: $${budget.current_spent.toFixed(2)} (${progress.percentage}%)\n`;
          output += `- Remaining: $${progress.remaining.toFixed(2)}\n\n`;
        }

        return {
          content: [
            {
              type: 'text',
              text: output
            }
          ]
        };

      case 'delete':
        if (!category) {
          throw new Error('Category is required for deleting a budget');
        }
        
        const deleteResult = await dbRun("DELETE FROM budgets WHERE category = ?", [category]);
        
        if (deleteResult.changes === 0) {
          throw new Error(`No budget found for category "${category}"`);
        }
        
        return {
          content: [
            {
              type: 'text',
              text: `✅ Budget for "${category}" has been deleted`
            }
          ]
        };

      default:
        throw new Error(`Unknown budget action: ${action}`);
    }
  }

  async trackFinancialGoal(args) {
    const { action, name, target_amount, current_amount, target_date, description, add_amount } = args;

    switch (action) {
      case 'create':
        if (!name || target_amount == null) {
          throw new Error('Name and target_amount are required for creating a goal');
        }
        
        await dbRun(
          "INSERT INTO financial_goals (name, target_amount, current_amount, target_date, description) VALUES (?, ?, ?, ?, ?)",
          [name, target_amount, current_amount || 0, target_date, description]
        );
        
        const progress = calculateGoalProgress(current_amount || 0, target_amount);
        
        return {
          content: [
            {
              type: 'text',
              text: `🎯 Goal created: "${name}"\n- Target: $${target_amount.toFixed(2)}\n- Current: $${(current_amount || 0).toFixed(2)} (${progress.percentage}%)\n- Remaining: $${progress.remaining.toFixed(2)}${target_date ? `\n- Target Date: ${target_date}` : ''}${description ? `\n- Description: ${description}` : ''}`
            }
          ]
        };

      case 'add_progress':
        if (!name || add_amount == null) {
          throw new Error('Name and add_amount are required for adding progress');
        }
        
        const goal = await dbGet("SELECT * FROM financial_goals WHERE name = ?", [name]);
        if (!goal) {
          throw new Error(`Goal "${name}" not found`);
        }
        
        const newAmount = goal.current_amount + add_amount;
        await dbRun("UPDATE financial_goals SET current_amount = ? WHERE name = ?", [newAmount, name]);
        
        const newProgress = calculateGoalProgress(newAmount, goal.target_amount);
        
        return {
          content: [
            {
              type: 'text',
              text: `🎯 Progress added to "${name}": +$${add_amount.toFixed(2)}\n- New total: $${newAmount.toFixed(2)} (${newProgress.percentage}%)\n- Remaining: $${newProgress.remaining.toFixed(2)}${newProgress.completed ? ' 🎉 GOAL COMPLETED!' : ''}`
            }
          ]
        };

      case 'view':
        const goals = await dbAll(
          name ? 
            "SELECT * FROM financial_goals WHERE name = ?" : 
            "SELECT * FROM financial_goals ORDER BY status, target_date",
          name ? [name] : []
        );

        if (goals.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: name ? 
                  `Goal "${name}" not found` : 
                  'No financial goals have been created yet'
              }
            ]
          };
        }

        let output = name ? 
          `🎯 **Goal: "${name}"**\n\n` : 
          `🎯 **All Financial Goals:**\n\n`;

        for (const goal of goals) {
          const progress = calculateGoalProgress(goal.current_amount, goal.target_amount);
          const statusEmoji = progress.completed ? '🏆' : 
                             progress.percentage >= 75 ? '🔥' : 
                             progress.percentage >= 50 ? '💪' : '🎯';
          
          output += `${statusEmoji} **${goal.name}** (${goal.status})\n`;
          output += `- Progress: $${goal.current_amount.toFixed(2)} / $${goal.target_amount.toFixed(2)} (${progress.percentage}%)\n`;
          output += `- Remaining: $${progress.remaining.toFixed(2)}\n`;
          if (goal.target_date) output += `- Target Date: ${goal.target_date}\n`;
          if (goal.description) output += `- Description: ${goal.description}\n`;
          output += '\n';
        }

        return {
          content: [
            {
              type: 'text',
              text: output
            }
          ]
        };

      case 'update':
        if (!name) {
          throw new Error('Name is required for updating a goal');
        }
        
        const existingGoal = await dbGet("SELECT * FROM financial_goals WHERE name = ?", [name]);
        if (!existingGoal) {
          throw new Error(`Goal "${name}" not found`);
        }
        
        const updates = [];
        const params = [];
        
        if (target_amount != null) {
          updates.push('target_amount = ?');
          params.push(target_amount);
        }
        if (current_amount != null) {
          updates.push('current_amount = ?');
          params.push(current_amount);
        }
        if (target_date != null) {
          updates.push('target_date = ?');
          params.push(target_date);
        }
        if (description != null) {
          updates.push('description = ?');
          params.push(description);
        }
        
        if (updates.length === 0) {
          throw new Error('No fields to update provided');
        }
        
        params.push(name);
        await dbRun(`UPDATE financial_goals SET ${updates.join(', ')} WHERE name = ?`, params);
        
        return {
          content: [
            {
              type: 'text',
              text: `✅ Goal "${name}" updated successfully`
            }
          ]
        };

      case 'delete':
        if (!name) {
          throw new Error('Name is required for deleting a goal');
        }
        
        const deleteResult = await dbRun("DELETE FROM financial_goals WHERE name = ?", [name]);
        
        if (deleteResult.changes === 0) {
          throw new Error(`Goal "${name}" not found`);
        }
        
        return {
          content: [
            {
              type: 'text',
              text: `✅ Goal "${name}" has been deleted`
            }
          ]
        };

      default:
        throw new Error(`Unknown goal action: ${action}`);
    }
  }

  async analyzeSpendingPatterns(args) {
    const { analysis_type = 'monthly_trends', months = 6 } = args;

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);
    
    switch (analysis_type) {
      case 'monthly_trends':
        const monthlyData = await dbAll(`
          SELECT 
            strftime('%Y-%m', date) as month,
            type,
            SUM(amount) as total
          FROM transactions 
          WHERE date >= ?
          GROUP BY strftime('%Y-%m', date), type
          ORDER BY month
        `, [startDate.toISOString().split('T')[0]]);

        let output = `📈 **Monthly Spending Trends (Last ${months} months):**\n\n`;
        
        const monthlyGroups = {};
        monthlyData.forEach(row => {
          if (!monthlyGroups[row.month]) {
            monthlyGroups[row.month] = { income: 0, expense: 0 };
          }
          monthlyGroups[row.month][row.type] = row.total;
        });

        Object.keys(monthlyGroups).forEach(month => {
          const data = monthlyGroups[month];
          const net = data.income - data.expense;
          output += `**${month}:**\n`;
          output += `- Income: $${data.income.toFixed(2)}\n`;
          output += `- Expenses: $${data.expense.toFixed(2)}\n`;
          output += `- Net: $${net.toFixed(2)} ${net >= 0 ? '✅' : '⚠️'}\n\n`;
        });

        return {
          content: [
            {
              type: 'text',
              text: output
            }
          ]
        };

      case 'category_breakdown':
        const categoryData = await dbAll(`
          SELECT 
            category,
            SUM(amount) as total,
            COUNT(*) as count,
            AVG(amount) as avg_amount
          FROM transactions 
          WHERE date >= ? AND type = 'expense'
          GROUP BY category
          ORDER BY total DESC
        `, [startDate.toISOString().split('T')[0]]);

        const totalExpenses = categoryData.reduce((sum, cat) => sum + cat.total, 0);

        let categoryOutput = `📊 **Expense Categories (Last ${months} months):**\n\n`;
        categoryOutput += `Total Expenses: $${totalExpenses.toFixed(2)}\n\n`;

        categoryData.forEach(cat => {
          const percentage = (cat.total / totalExpenses * 100).toFixed(1);
          categoryOutput += `**${cat.category}:** $${cat.total.toFixed(2)} (${percentage}%)\n`;
          categoryOutput += `- ${cat.count} transactions, avg $${cat.avg_amount.toFixed(2)}\n\n`;
        });

        return {
          content: [
            {
              type: 'text',
              text: categoryOutput
            }
          ]
        };

      case 'budget_vs_actual':
        const budgets = await dbAll("SELECT * FROM budgets");
        
        if (budgets.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No budgets have been created yet. Use manage_budget to create budgets first.'
              }
            ]
          };
        }

        let budgetOutput = `💰 **Budget vs Actual Analysis:**\n\n`;

        for (const budget of budgets) {
          const progress = calculateBudgetProgress(budget.current_spent, budget.monthly_limit);
          const statusEmoji = progress.status === 'good' ? '✅' : 
                             progress.status === 'warning' ? '⚠️' : '🚨';
          
          budgetOutput += `${statusEmoji} **${budget.category}**\n`;
          budgetOutput += `- Budget: $${budget.monthly_limit.toFixed(2)}\n`;
          budgetOutput += `- Spent: $${budget.current_spent.toFixed(2)} (${progress.percentage}%)\n`;
          budgetOutput += `- Status: ${progress.status.replace('_', ' ')}\n\n`;
        }

        return {
          content: [
            {
              type: 'text',
              text: budgetOutput
            }
          ]
        };

      case 'expense_insights':
        const recentExpenses = await dbAll(`
          SELECT *
          FROM transactions 
          WHERE type = 'expense' AND date >= ?
          ORDER BY date DESC
        `, [startDate.toISOString().split('T')[0]]);

        if (recentExpenses.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: 'No expenses found in the specified period.'
              }
            ]
          };
        }

        const avgDaily = recentExpenses.reduce((sum, exp) => sum + exp.amount, 0) / (months * 30);
        const biggestExpense = Math.max(...recentExpenses.map(exp => exp.amount));
        const smallestExpense = Math.min(...recentExpenses.map(exp => exp.amount));
        
        // Find most frequent category
        const categoryCounts = {};
        recentExpenses.forEach(exp => {
          categoryCounts[exp.category] = (categoryCounts[exp.category] || 0) + 1;
        });
        const topCategory = Object.keys(categoryCounts).reduce((a, b) => 
          categoryCounts[a] > categoryCounts[b] ? a : b);

        let insightOutput = `🔍 **Spending Insights (Last ${months} months):**\n\n`;
        insightOutput += `📊 **Statistics:**\n`;
        insightOutput += `- Total transactions: ${recentExpenses.length}\n`;
        insightOutput += `- Average daily spending: $${avgDaily.toFixed(2)}\n`;
        insightOutput += `- Biggest expense: $${biggestExpense.toFixed(2)}\n`;
        insightOutput += `- Smallest expense: $${smallestExpense.toFixed(2)}\n`;
        insightOutput += `- Most frequent category: ${topCategory} (${categoryCounts[topCategory]} times)\n\n`;

        // Add spending patterns
        const weeklySpending = {};
        recentExpenses.forEach(exp => {
          const date = new Date(exp.date);
          const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' });
          weeklySpending[dayOfWeek] = (weeklySpending[dayOfWeek] || 0) + exp.amount;
        });

        insightOutput += `📅 **Spending by Day of Week:**\n`;
        Object.entries(weeklySpending)
          .sort(([,a], [,b]) => b - a)
          .forEach(([day, amount]) => {
            insightOutput += `- ${day}: $${amount.toFixed(2)}\n`;
          });

        return {
          content: [
            {
              type: 'text',
              text: insightOutput
            }
          ]
        };

      default:
        throw new Error(`Unknown analysis type: ${analysis_type}`);
    }
  }

  async manageAccounts(args) {
    const { action, name, type, balance } = args;

    switch (action) {
      case 'create':
        if (!name || !type) {
          throw new Error('Name and type are required for creating an account');
        }
        
        try {
          await dbRun("INSERT INTO accounts (name, type, balance) VALUES (?, ?, ?)", 
            [name, type, balance || 0]);
          return {
            content: [
              {
                type: 'text',
                text: `✅ Account created: "${name}" (${type}) with balance $${(balance || 0).toFixed(2)}`
              }
            ]
          };
        } catch (error) {
          if (error.message.includes('UNIQUE constraint failed')) {
            throw new Error(`Account "${name}" already exists`);
          }
          throw error;
        }

      case 'view':
        const accounts = await dbAll(
          name ? 
            "SELECT * FROM accounts WHERE name = ?" : 
            "SELECT * FROM accounts ORDER BY type, name",
          name ? [name] : []
        );

        if (accounts.length === 0) {
          return {
            content: [
              {
                type: 'text',
                text: name ? 
                  `Account "${name}" not found` : 
                  'No accounts found'
              }
            ]
          };
        }

        let output = name ? 
          `💳 **Account: "${name}"**\n\n` : 
          `💳 **All Accounts:**\n\n`;

        const totalBalance = accounts.reduce((sum, acc) => sum + acc.balance, 0);
        
        if (!name) {
          output += `**Total Balance: $${totalBalance.toFixed(2)}**\n\n`;
        }

        accounts.forEach(account => {
          const typeEmoji = {
            'checking': '🏦',
            'savings': '💰',
            'credit': '💳',
            'investment': '📈',
            'cash': '💵'
          }[account.type] || '💳';
          
          output += `${typeEmoji} **${account.name}** (${account.type})\n`;
          output += `- Balance: $${account.balance.toFixed(2)}\n`;
          output += `- Created: ${account.created_at.split('T')[0]}\n\n`;
        });

        return {
          content: [
            {
              type: 'text',
              text: output
            }
          ]
        };

      case 'update':
        if (!name) {
          throw new Error('Name is required for updating an account');
        }
        
        const updates = [];
        const params = [];
        
        if (type != null) {
          updates.push('type = ?');
          params.push(type);
        }
        if (balance != null) {
          updates.push('balance = ?');
          params.push(balance);
        }
        
        if (updates.length === 0) {
          throw new Error('No fields to update provided');
        }
        
        params.push(name);
        const result = await dbRun(`UPDATE accounts SET ${updates.join(', ')} WHERE name = ?`, params);
        
        if (result.changes === 0) {
          throw new Error(`Account "${name}" not found`);
        }
        
        return {
          content: [
            {
              type: 'text',
              text: `✅ Account "${name}" updated successfully`
            }
          ]
        };

      case 'delete':
        if (!name) {
          throw new Error('Name is required for deleting an account');
        }
        
        // Check if account has transactions
        const transactionCount = await dbGet(
          "SELECT COUNT(*) as count FROM transactions WHERE account = ?", 
          [name]
        );
        
        if (transactionCount.count > 0) {
          throw new Error(`Cannot delete account "${name}" - it has ${transactionCount.count} associated transactions`);
        }
        
        const deleteResult = await dbRun("DELETE FROM accounts WHERE name = ?", [name]);
        
        if (deleteResult.changes === 0) {
          throw new Error(`Account "${name}" not found`);
        }
        
        return {
          content: [
            {
              type: 'text',
              text: `✅ Account "${name}" has been deleted`
            }
          ]
        };

      default:
        throw new Error(`Unknown account action: ${action}`);
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Personal Finance MCP Server running on stdio');
  }
}

// CLI setup
const argv = yargs(hideBin(process.argv))
  .option('stdio', {
    describe: 'Use stdio transport',
    type: 'boolean',
    default: true
  })
  .help()
  .alias('help', 'h')
  .argv;

async function main() {
  try {
    await initDatabase();
    const server = new PersonalFinanceServer();
    await server.run();
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}