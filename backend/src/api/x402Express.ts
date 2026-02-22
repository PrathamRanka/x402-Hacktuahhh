import { Request, Response } from 'express';
import { CdpClient } from "@coinbase/cdp-sdk";
import { HTTPFacilitatorClient, x402ResourceServer, x402HTTPResourceServer } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { processPayment } from '../payment/engine';
import { getCurrentPrice } from '../agent/negotiationAgent';

const cdp = new CdpClient({
  apiKeyId: process.env.CDP_API_KEY_ID!,
  apiKeySecret: process.env.CDP_API_KEY_SECRET!,
  walletSecret: process.env.CDP_WALLET_SECRET!,
});

let payToAddress: string | null = null;

async function initializePayToAddress(): Promise<string> {
  if (payToAddress) return payToAddress;
  const account = await cdp.evm.createAccount();
  payToAddress = account.address;
  console.log(`[x402 Express] Pay-to initialized: ${payToAddress}`);
  return payToAddress;
}

export async function handleX402Request(req: Request, res: Response) {
  try {
    const walletAddress = req.headers["x-wallet-address"] as string;
    const domain = req.headers["x-domain"] as string || 'unknown';

    if (!walletAddress) {
      return res.status(400).json({ error: "X-Wallet-Address header required" });
    }

    // Identify standard total price for this user
    const state = getCurrentPrice(walletAddress, domain);
    const actionCostCents = state.cents;

    // Process partial/full payment using credits first
    const { remainingCostCents, creditsDeducted, transactionId } = await processPayment(
      actionCostCents, 
      walletAddress, 
      'CREDITS_FIRST'
    );

    // If credits covered the whole cost, immediately return the data
    if (remainingCostCents <= 0) {
      return res.status(200).json({
        success: true,
        message: "Payment fully covered by credits!",
        data: { timestamp: new Date().toISOString() },
        settlement: {
          transactionHash: transactionId,
          network: "x402-credits",
          explorerUrl: null,
          settled: true,
          pricePaid: { cents: actionCostCents, dollars: (actionCostCents / 100).toFixed(2) }
        }
      });
    }

    // Credits did not fully cover. Spin up X402 for the remaining balance.
    const payTo = await initializePayToAddress();
    
    const facilitatorClient = new HTTPFacilitatorClient({
      url: "https://x402.org/facilitator",
    });

    const resourceServer = new x402ResourceServer(facilitatorClient);
    registerExactEvmScheme(resourceServer, { networks: ["eip155:84532"] }); // Base Sepolia

    const priceString = `$${(remainingCostCents / 100).toFixed(2)}`;
    
    // X402 expects the exact path configured
    const requestPath = req.path; // usually /api/x402
    const methodPath = `${req.method} ${requestPath}`;
    
    const routesConfig = {
      [methodPath]: {
        accepts: [{
          scheme: "exact" as const,
          price: priceString,
          network: "eip155:84532" as `${string}:${string}`,
          payTo: payTo,
        }],
        description: "Remaining cost for premium data after credits applied",
        mimeType: "application/json",
      },
    };

    const httpServer = new x402HTTPResourceServer(resourceServer, routesConfig);
    await httpServer.initialize();

    const adapter = {
      getHeader: (name: string) => req.header(name),
      getMethod: () => req.method,
      getPath: () => req.path,
      getUrl: () => req.originalUrl,
      getAcceptHeader: () => req.header("accept") || "",
      getUserAgent: () => req.header("user-agent") || "",
      getQueryParams: () => req.query as Record<string, string>,
      getQueryParam: (name: string) => req.query[name] as string | undefined,
      getBody: () => req.body,
    };

    const context = { adapter, path: req.path, method: req.method };
    const result = await httpServer.processHTTPRequest(context);

    if (result.type === "payment-error") {
      // Return 402 exactly as x402 expects
      for (const [key, value] of Object.entries(result.response.headers)) {
        res.setHeader(key, String(value));
      }
      return res.status(result.response.status).json({
        ...((typeof result.response.body === 'object' && result.response.body) || {}),
        currentPrice: {
          cents: actionCostCents,
          dollars: (actionCostCents / 100).toFixed(2),
        },
        remainingRequiredCents: remainingCostCents,
        creditsDeducted
      });
    }

    if (result.type === "payment-verified") {
      const settlementResult = await httpServer.processSettlement(
        result.paymentPayload,
        result.paymentRequirements
      );

      if (!settlementResult.success) {
        return res.status(402).json({
          error: "Payment settlement failed",
          details: settlementResult.errorReason,
        });
      }

      const txHash = settlementResult.transaction;
      const network = result.paymentRequirements.network;
      const explorerUrl = network === "eip155:84532" && txHash ? `https://sepolia.basescan.org/tx/${txHash}` : null;

      for (const [key, value] of Object.entries(settlementResult.headers)) {
        res.setHeader(key, String(value));
      }

      return res.status(200).json({
        success: true,
        message: "Payment settled successfully!",
        data: { timestamp: new Date().toISOString() },
        settlement: {
          transactionHash: txHash || null,
          network,
          explorerUrl,
          settled: true,
          pricePaid: { cents: remainingCostCents, dollars: (remainingCostCents / 100).toFixed(2) }
        }
      });
    }

    return res.json({ success: true, message: "Request processed without payment" });

  } catch (error) {
    console.error("X402 Express Error:", error);
    res.status(500).json({ error: "Payment processing failed" });
  }
}
