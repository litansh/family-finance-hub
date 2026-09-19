import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { RiseupBudget, RiseupTransactionsResponse } from '@hub/core';

export interface Riseup {
  budget(month: string): Promise<RiseupBudget>;
  transactions(month: string): Promise<RiseupTransactionsResponse>;
  close(): Promise<void>;
}

export class RiseupAuthError extends Error {}

// Talks to the official RiseUp MCP server over stdio, the same way Claude does.
// `serverPath` is the server's entry file; the PAT reaches it through its env only.
export async function connectRiseup(pat: string, serverPath: string): Promise<Riseup> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
    env: { PATH: process.env.PATH ?? '', RISEUP_PAT: pat },
    stderr: 'inherit',
  });
  const client = new Client({ name: 'family-finance-hub', version: '0.1.0' });
  await client.connect(transport);

  async function call<T>(name: string, args: Record<string, string>): Promise<T> {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as { type: string; text?: string }[]).find((c) => c.type === 'text')?.text ?? '';
    if (res.isError) {
      if (/\b(401|403)\b/.test(text)) throw new RiseupAuthError(text);
      throw new Error(`${name} failed: ${text.slice(0, 300)}`);
    }
    return JSON.parse(text) as T;
  }

  return {
    budget: (month) => call('get_budget', { date: month }),
    transactions: (month) => call('get_transactions', { cashflowMonth: month }),
    close: () => client.close(),
  };
}
