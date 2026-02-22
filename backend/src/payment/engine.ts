import { getUserCreditsCollection, getCreditTransactionsCollection, TransactionStatus } from '../db';
import crypto from 'crypto';

export type PaymentPreference = 'CREDITS_FIRST' | 'DIRECT_USDC';

export interface PaymentProcessResult {
  remainingCostCents: number;
  creditsDeducted: number;
  transactionId?: string; // The transaction ID of the usage, needed if a refund must occur
}

/**
 * processPayment
 * Fetches credit balance, deducts available credits according to priority,
 * and returns the remaining cost that must be handled by external USDC payment.
 */
export async function processPayment(
  actionCostCents: number,
  userId: string,
  paymentPreference: PaymentPreference = 'CREDITS_FIRST'
): Promise<PaymentProcessResult> {
  if (actionCostCents <= 0) {
    return { remainingCostCents: 0, creditsDeducted: 0 };
  }

  if (paymentPreference === 'DIRECT_USDC') {
    return { remainingCostCents: actionCostCents, creditsDeducted: 0 };
  }

  const creditsCol = await getUserCreditsCollection();
  const txCol = await getCreditTransactionsCollection();

  // Atomically check and deduct credits if possible
  // Since we might need to deduct a partial amount, we must do a find and update using logic,
  // or a two-step if we want to be perfectly atomic without transactions. MongoDB findOneAndUpdate works.

  let deducted = 0;
  let remainingCents = actionCostCents;
  const txId = crypto.randomUUID();

  // Retry loop for optimistic concurrency-like atomicity or simple locks
  // Using findOneAndUpdate with condition balance > 0
  const userCredit = await creditsCol.findOne({ userId });
  if (!userCredit || userCredit.balance <= 0) {
    return { remainingCostCents: actionCostCents, creditsDeducted: 0 };
  }

  const toDeduct = Math.min(userCredit.balance, actionCostCents);
  
  // Try atomic deduct
  const updateResult = await creditsCol.findOneAndUpdate(
    { userId, balance: { $gte: toDeduct } },
    { 
      $inc: { balance: -toDeduct, lifetimeUsed: toDeduct },
      $set: { updatedAt: new Date() }
    },
    { returnDocument: 'after' }
  );

  if (!updateResult) {
    // Race condition lost or balance insufficient now, fallback to safe mode
    return await processPayment(actionCostCents, userId, paymentPreference);
  }

  deducted = toDeduct;
  remainingCents = actionCostCents - deducted;

  // Insert ledger entry
  await txCol.insertOne({
    id: txId,
    userId,
    type: 'USAGE',
    amount: -deducted,
    status: 'CONFIRMED', 
    metadata: { requiredCost: actionCostCents },
    createdAt: new Date()
  });

  return { remainingCostCents: remainingCents, creditsDeducted: deducted, transactionId: txId };
}

/**
 * refundCredits
 * Refunds credits that were deducted if the subsequent USDC payment fallback failed.
 */
export async function refundCredits(originalTransactionId: string): Promise<boolean> {
  const txCol = await getCreditTransactionsCollection();
  const creditsCol = await getUserCreditsCollection();

  const originalTx = await txCol.findOne({ id: originalTransactionId, type: 'USAGE', status: 'CONFIRMED' });
  if (!originalTx) return false;

  const refundTxId = crypto.randomUUID();

  // Prevent double refunds
  const existingRefund = await txCol.findOne({ type: 'REFUND', "metadata.originalTxId": originalTransactionId });
  if (existingRefund) return false;

  const refundAmount = Math.abs(originalTx.amount);

  // Apply refund
  await creditsCol.updateOne(
    { userId: originalTx.userId },
    { 
      $inc: { balance: refundAmount },
      $set: { updatedAt: new Date() }
    }
  );

  await txCol.insertOne({
    id: refundTxId,
    userId: originalTx.userId,
    type: 'REFUND',
    amount: refundAmount,
    status: 'CONFIRMED',
    metadata: { originalTxId: originalTransactionId, reason: 'USDC_FALLBACK_FAILED' },
    createdAt: new Date()
  });

  return true;
}

/**
 * mintCredits
 * Converts confirmed USDC deposit to ledger balance.
 */
export async function mintCredits(userId: string, amountCents: number, txHash: string): Promise<boolean> {
  const txCol = await getCreditTransactionsCollection();
  const creditsCol = await getUserCreditsCollection();

  // Check unique txHash across successful deposits to ensure idempotency
  const existingDeposit = await txCol.findOne({ txHash, status: 'CONFIRMED' });
  if (existingDeposit) {
    return true; // Already processed
  }

  const txId = crypto.randomUUID();

  await txCol.insertOne({
    id: txId,
    userId,
    type: 'PURCHASE',
    amount: amountCents,
    txHash,
    status: 'CONFIRMED',
    createdAt: new Date()
  });

  // Upsert user credits
  await creditsCol.updateOne(
    { userId },
    { 
      $inc: { balance: amountCents, lifetimePurchased: amountCents },
      $set: { updatedAt: new Date() },
      $setOnInsert: { lifetimeUsed: 0 }
    },
    { upsert: true }
  );

  return true;
}

export async function getUserCredits(userId: string): Promise<number> {
  const creditsCol = await getUserCreditsCollection();
  const user = await creditsCol.findOne({ userId });
  return user?.balance || 0;
}
