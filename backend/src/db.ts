import { MongoClient, Db, Collection } from "mongodb";

let client: MongoClient | null = null;
let connectPromise: Promise<MongoClient> | null = null;

export interface UserCredit {
  userId: string;
  balance: number; // in cents
  lifetimePurchased: number;
  lifetimeUsed: number;
  updatedAt: Date;
}

export type TransactionType = 'PURCHASE' | 'USAGE' | 'DIRECT_USDC' | 'REFUND' | 'ADJUSTMENT';
export type TransactionStatus = 'PENDING' | 'CONFIRMED' | 'FAILED';

export interface CreditTransaction {
  id: string; // unique idempotent key or tx hash
  userId: string;
  type: TransactionType;
  amount: number; // in cents; negative for usage/refund, positive for purchase
  txHash?: string; // on-chain hash if relevant
  status: TransactionStatus;
  metadata?: any;
  createdAt: Date;
}

export async function getDb(): Promise<Db> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI environment variable is required");
  }

  if (!client) {
    if (!connectPromise) {
      const newClient = new MongoClient(uri);
      connectPromise = newClient.connect();
    }
    client = await connectPromise;
  }

  return client.db();
}

export async function getUserCreditsCollection(): Promise<Collection<UserCredit>> {
  const db = await getDb();
  return db.collection<UserCredit>('userCredits');
}

export async function getCreditTransactionsCollection(): Promise<Collection<CreditTransaction>> {
  const db = await getDb();
  return db.collection<CreditTransaction>('creditTransactions');
}

