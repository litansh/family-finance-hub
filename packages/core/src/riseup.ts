// Wire types for RiseUp's external API, as documented by @riseup-oss/mcp v0.3.
// Fields RiseUp marks as "may be absent" are optional here.

export type EnvelopeType =
  | 'fixed'
  | 'variable'
  | 'variableIncome'
  | 'trackingCategory'
  | 'riseupGoal';

export interface RiseupActual {
  transactionId: string;
  transactionDate: string; // YYYY-MM-DD
  billingDate?: string;
  businessName: string;
  isIncome: boolean;
  billingAmount: number | null; // expenses
  incomeAmount: number | null; // incomes
  originalAmount?: number;
  accountNickname?: string | null;
  accountNumberHash?: string | null;
  isInstallment?: boolean;
  paymentNumber?: number;
  totalNumberOfPayments?: number;
  expense?: string; // RiseUp's system label; the customer-facing one is the transaction's categoryLabel
  placement?: string;
  monthsInterval?: number;
  transactionBudgetDate?: string;
  sequenceId?: string;
  isPostponed?: boolean;
  sourceType?: string;
  source?: string;
}

export interface RiseupEnvelope {
  id: string;
  type: EnvelopeType;
  // Observed on real accounts, and not what RiseUp's tool description says:
  // fixed envelopes carry the plan here with expenses POSITIVE and incomes
  // negative; tracked categories carry 0 here and their plan in
  // originalAmount; the everyday `variable` envelope has null in both.
  balancedAmount: number | null;
  originalAmount?: number | null;
  balanceDate?: string;
  isCustomPrediction?: boolean;
  sequenceCustomerComment?: string;
  actuals: RiseupActual[];
}

export interface RiseupBudget {
  budgetDate: string; // YYYY-MM
  lastUpdatedAt: string;
  envelopes: RiseupEnvelope[];
  excluded?: RiseupActual[];
}

export interface RiseupTransaction {
  transactionId: string;
  transactionDate: string; // ISO datetime, UTC midnight
  billingDate?: string;
  cashflowDate: string; // YYYY-MM
  businessName: string;
  isIncome: boolean;
  amount: number; // absolute ILS
  accountNickname?: string | null;
  accountNumberHash?: string | null;
  isInstallment?: boolean;
  installmentNumber?: number;
  totalNumberOfInstallments?: number;
  isPostponed?: boolean;
  sourceType?: string;
  source?: string;
  commitmentId?: string | null;
  actualType?: 'fixed' | 'variable';
  categoryLabel?: string;
  categoryType?: 'default' | 'custom' | 'other';
}

export interface RiseupTransactionsResponse {
  transactions: RiseupTransaction[];
}
