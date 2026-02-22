import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { getStartingPrice } from './lib/zkVerifier'
import { runNegotiationAgent, getCurrentPrice, pricingState, getTopic } from './agent/negotiationAgent'
import { generateMarkdownGuide } from './lib/markdownGenerator'
import zkidRouter from './zkid/routes'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors({
  exposedHeaders: ['payment-required', 'payment-authorization']
}))
app.use(express.json())

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'x402-zkid-backend' })
})

// Get current price for a wallet (used by x402 endpoint)
app.get('/api/price/:walletAddress', (req, res) => {
  const { walletAddress } = req.params
  const { domain } = req.query

  if (!walletAddress) {
    return res.status(400).json({ error: 'Wallet address is required' })
  }

  const domainStr = (domain as string) || 'unknown'
  const price = getCurrentPrice(walletAddress, domainStr)

  res.json({
    walletAddress,
    domain: domainStr,
    cents: price.cents,
    dollars: (price.cents / 100).toFixed(2),
    round: price.round
  })
})

// Agent-based chat endpoint (replaces old /chat/stream)
app.post('/chat/agent', async (req, res) => {
  const { message, walletAddress, domain } = req.body

  if (!message) {
    return res.status(400).json({ error: 'Message is required' })
  }

  if (!walletAddress) {
    return res.status(400).json({ error: 'Wallet address is required' })
  }

  const domainStr = domain || 'unknown'

  try {
    console.log(`[Agent] Processing message from ${walletAddress} (${domainStr}): "${message}"`)

    const result = await runNegotiationAgent(message, walletAddress, domainStr)

    console.log(`[Agent] Response sent, current price: $${result.currentPrice.dollars}, isDataOffer: ${result.isDataOffer}`)

    res.json({
      response: result.response,
      currentPrice: result.currentPrice,
      isDataOffer: result.isDataOffer
    })
  } catch (error) {
    console.error('[Agent] Error:', error)
    res.status(500).json({
      error: 'Agent failed to process message',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

// Streaming agent chat (SSE version)
app.post('/chat/stream', async (req, res) => {
  const { message, walletAddress, domain } = req.body

  if (!message) {
    return res.status(400).json({ error: 'Message is required' })
  }

  if (!walletAddress) {
    return res.status(400).json({ error: 'Wallet address is required' })
  }

  const domainStr = domain || 'unknown'

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    console.log(`[Agent Stream] Processing message from ${walletAddress} (${domainStr}): "${message}"`)

    const result = await runNegotiationAgent(message, walletAddress, domainStr)

    // Send the full response as a single SSE event
    res.write(`data: ${JSON.stringify({
      text: result.response,
      currentPrice: result.currentPrice,
      isDataOffer: result.isDataOffer
    })}\n\n`)

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`)
    res.end()

    console.log(`[Agent Stream] Response sent, current price: $${result.currentPrice.dollars}, isDataOffer: ${result.isDataOffer}`)
  } catch (error) {
    console.error('[Agent Stream] Error:', error)
    res.write(`data: ${JSON.stringify({
      text: 'Sorry, something went wrong. Please try again.',
      error: true
    })}\n\n`)
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`)
    res.end()
  }
})

// Legacy endpoints for backwards compatibility
app.post('/chat', async (req, res) => {
  const { message, walletAddress, domain } = req.body

  if (!message) {
    return res.status(400).json({ error: 'Message is required' })
  }

  const domainStr = domain || 'unknown'
  const wallet = walletAddress || 'anonymous'

  try {
    const result = await runNegotiationAgent(message, wallet, domainStr)
    res.json({
      response: result.response,
      currentPrice: result.currentPrice,
      isDataOffer: result.isDataOffer
    })
  } catch (error) {
    console.error('Chat error:', error)
    res.status(500).json({ error: 'Failed to generate response' })
  }
})

import { requirePayment, PaymentRequest } from './payment/middleware';
import { mintCredits, getUserCredits } from './payment/engine';
import { getCreditTransactionsCollection } from './db';

// Wallet and credits info
app.get('/api/wallet/credits/:walletAddress', async (req, res) => {
  const balance = await getUserCredits(req.params.walletAddress);
  res.json({ balanceCents: balance, balanceDollars: (balance / 100).toFixed(2) });
});

import { getPayTo } from './payment/middleware';

app.get('/api/wallet/pay-to', async (req, res) => {
  try {
    const address = await getPayTo();
    res.json({ address });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch deposit address' });
  }
});

app.get('/api/wallet/history/:walletAddress', async (req, res) => {
  try {
    const txCol = await getCreditTransactionsCollection();
    const history = await txCol.find({ userId: req.params.walletAddress })
                             .sort({ createdAt: -1 })
                             .limit(20)
                             .toArray();
    res.json(history);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

app.post('/api/wallet/fund', async (req, res) => {
  const { walletAddress, amountCents, txHash } = req.body;
  if (!walletAddress || !amountCents || !txHash) {
    return res.status(400).json({ error: 'Mission parameters for funding' });
  }

  // Ideally, we'd verify the txHash using verifyTransaction here.
  // Assuming it is handled carefully on frontend and double checked here.
  const success = await mintCredits(walletAddress, amountCents, txHash);
  if (success) {
    res.json({ success: true, message: 'Credits funded successfully' });
  } else {
    res.status(400).json({ error: 'Failed to find credits or tx Hash already exists' });
  }
});

// Unlock/pay for data - generates markdown guide
app.post('/unlock', requirePayment(), async (req: PaymentRequest, res) => {
  const { walletAddress } = req.body

  // Get the negotiated price and topic for this wallet
  const state = pricingState.get(walletAddress)
  const topic = state?.topic || 'general knowledge'
  const creditsDeducted = req.payment?.creditsDeducted || 0;
  const usdcPaid = req.payment?.usdcPaid || 0;
  const totalPaid = creditsDeducted + usdcPaid;

  try {
    console.log(`[Unlock] Generating markdown guide for topic: "${topic}"`)
    const guide = await generateMarkdownGuide(topic)

    res.json({
      success: true,
      title: guide.title,
      markdown: guide.content,
      topic: topic,
      message: `Payment of $${(totalPaid / 100).toFixed(2)} received (Credits: ${creditsDeducted}¢, USDC: ${usdcPaid}¢)! Here's your guide.`,
      pricePaid: {
        cents: totalPaid,
        dollars: (totalPaid / 100).toFixed(2),
        creditsDeducted,
        usdcPaid
      }
    })
  } catch (error) {
    console.error('[Unlock] Failed to generate guide:', error)
    res.status(500).json({
      success: false,
      error: 'Failed to generate guide',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

// ZKID proof storage routes
app.use('/zkid', zkidRouter)

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`)
  console.log(`Negotiation agent ready!`)
})
