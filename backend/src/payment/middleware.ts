import { Request, Response, NextFunction } from 'express';
import { processPayment } from './engine';
import { getCurrentPrice } from '../agent/negotiationAgent';
import { getCreditTransactionsCollection } from '../db';
import { CdpClient } from "@coinbase/cdp-sdk";
import { HTTPFacilitatorClient, x402ResourceServer, x402HTTPResourceServer } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";

export interface PaymentRequest extends Request {
  payment?: {
    creditsDeducted: number;
    usdcPaid: number;
    transactionId?: string;
  };
}

let cdpClient: CdpClient;
let payToAddress: string | null = null;

export async function getPayTo(): Promise<string> {
  if (payToAddress) return payToAddress;
  if (!cdpClient) {
    cdpClient = new CdpClient({
      apiKeyId: process.env.CDP_API_KEY_ID || '',
      apiKeySecret: process.env.CDP_API_KEY_SECRET || '',
      walletSecret: process.env.CDP_WALLET_SECRET || '',
    });
  }
  const account = await cdpClient.evm.createAccount();
  payToAddress = account.address;
  return payToAddress;
}

/**
 * requirePayment Middleware
 * 1. Checks credits and deducts via processPayment engine
 * 2. If remaining > 0, initializes X402 server to demand USDC via 402 protocol
 * 3. Settles X402, logs fallback to ledger, and calls next() if fully paid.
 */
export const requirePayment = () => {
  return async (req: PaymentRequest, res: Response, next: NextFunction) => {
    try {
      // Typically we get these from headers for x402 style requests or body
      const walletAddress = (req.headers["x-wallet-address"] as string) || req.body.walletAddress;
      const domain = (req.headers["x-domain"] as string) || req.body.domain || 'unknown';
      const useCreditsFirst = req.body.useCreditsFirst !== false; // Explicit toggle if any
      
      if (!walletAddress) {
        return res.status(400).json({ error: 'walletAddress is required for payment' });
      }

      // X402 state lookup: Are we already in an X402 Settlement loop? 
      // i.e., Does the request have the Payment-Authorization header?
      const isSettling = !!req.headers["payment-authorization"];

      const state = getCurrentPrice(walletAddress, domain);
      const actionCost = state.cents;
      const paymentPref = useCreditsFirst ? 'CREDITS_FIRST' : 'DIRECT_USDC';

      // Only deduct credits if NOT currently settling a previous 402, 
      // or we'd double-deduct. If settling, the remaining cost was already determined!
      let remainingCostCents = actionCost;
      let creditsDeducted = 0;
      let transactionId: string | undefined;

      if (!isSettling) {
        // First approach: process payment. Deducts credits atomically.
        const result = await processPayment(actionCost, walletAddress, paymentPref);
        remainingCostCents = result.remainingCostCents;
        creditsDeducted = result.creditsDeducted;
        transactionId = result.transactionId;
      } else {
        // Find the pending transaction amount from ledger? For simplicity in demo:
        // Assume whatever was requested required usdc verification.
        // We really should cache or check db to find exact remaining amount for this settlement.
        // As a safe fallback here, we assume remainingCost is what they are paying us.
        // A full robust implementation fetches the pending intent from DB.
        
        // Let's check recent Usage tx for this user to find the deduction
        const txCol = await getCreditTransactionsCollection();
        const latestTx = await txCol.findOne(
          { userId: walletAddress, type: 'USAGE' },
          { sort: { createdAt: -1 } }
        );
        if (latestTx && Date.now() - latestTx.createdAt.getTime() < 300000) {
           creditsDeducted = -latestTx.amount;
           remainingCostCents = actionCost - creditsDeducted;
           transactionId = latestTx.id;
        }
      }

      // If fully covered by credits
      if (remainingCostCents <= 0 && !isSettling) {
        req.payment = { creditsDeducted, usdcPaid: 0, transactionId };
        return next();
      }

      // Remaining > 0, we need X402
      const payTo = await getPayTo();
      const facilitatorClient = new HTTPFacilitatorClient({ url: "https://x402.org/facilitator" });
      const resourceServer = new x402ResourceServer(facilitatorClient);
      registerExactEvmScheme(resourceServer, { networks: ["eip155:84532"] });

      const priceStr = `$${(remainingCostCents / 100).toFixed(2)}`;
      
      const routesConfig = {
        [`${req.method} ${req.path}`]: {
          accepts: [{ scheme: "exact" as const, price: priceStr, network: "eip155:84532" as const, payTo }],
          description: "USDC Fallback for remaining credits",
          mimeType: "application/json",
        },
      };

      const httpServer = new x402HTTPResourceServer(resourceServer, routesConfig);
      await httpServer.initialize();

      const adapter = {
        getHeader: (name: string) => req.header(name) || undefined,
        getMethod: () => req.method,
        getPath: () => req.path,
        getUrl: () => req.originalUrl,
        getAcceptHeader: () => req.header("accept") || "",
        getUserAgent: () => req.header("user-agent") || "",
        getQueryParams: () => req.query as Record<string, string>,
        getQueryParam: (name: string) => req.query[name] as string | undefined,
        getBody: () => req.body,
      };

      const result = await httpServer.processHTTPRequest({ adapter, path: req.path, method: req.method });

      if (result.type === "payment-error") {
        for (const [k, v] of Object.entries(result.response.headers)) res.setHeader(k, String(v));
        return res.status(result.response.status).json({
           ...((typeof result.response.body === 'object' && result.response.body) || {}),
           creditsDeducted,
           remainingRequiredCents: remainingCostCents
        });
      }

      if (result.type === "payment-verified") {
        const settlement = await httpServer.processSettlement(result.paymentPayload, result.paymentRequirements);
        
        if (!settlement.success) {
          return res.status(402).json({ error: "Settlement failed", details: settlement.errorReason });
        }

        // Record USDC fallback in DB
        const txCol = await getCreditTransactionsCollection();
        await txCol.insertOne({
          id: transactionId || crypto.randomUUID(), // sharing ID with usage or new one
          userId: walletAddress,
          type: 'DIRECT_USDC',
          amount: remainingCostCents,
          txHash: settlement.transaction || undefined,
          status: 'CONFIRMED',
          metadata: { action: 'x402_fallback' },
          createdAt: new Date()
        });

        req.payment = {
          creditsDeducted,
          usdcPaid: remainingCostCents,
          transactionId: settlement.transaction || transactionId
        };
        
        // Pass X402 settlement headers down to the next payload via properties or let express append them later
        for (const [k, v] of Object.entries(settlement.headers)) res.setHeader(k, String(v));

        return next();
      }

      next();
    } catch (error) {
      console.error('Payment Middleware Error:', error);
      res.status(500).json({ error: 'Internal payment error' });
    }
  };
};
