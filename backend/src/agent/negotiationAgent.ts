import { GoogleGenerativeAI } from '@google/generative-ai';
import { isEduDomain, isOrgDomain, getNextPrice, getFloorPrice, getStartingPrice } from '../lib/zkVerifier';

// ============================================================================
// CONFIGURATION - Change this single line to switch Gemini models
// ============================================================================
const GEMINI_MODEL = 'models/gemini-2.5-flash-lite';
// Examples of other models you can use:
// const GEMINI_MODEL = 'models/gemini-1.5-flash';
// const GEMINI_MODEL = 'models/gemini-1.5-pro';
// const GEMINI_MODEL = 'models/gemini-2.0-flash-thinking-exp';
// ============================================================================

// In-memory pricing state (per wallet session)
export const pricingState = new Map<string, { cents: number; round: number; domain: string; topic?: string; negotiationAttempts: number }>();

// Get current price for a wallet (or initialize with starting price based on domain)
export function getCurrentPrice(walletAddress: string, domain: string): { cents: number; round: number; negotiationAttempts: number } {
  const existing = pricingState.get(walletAddress);
  if (existing) {
    return { cents: existing.cents, round: existing.round, negotiationAttempts: existing.negotiationAttempts };
  }
  // Initialize with starting price based on domain
  const startingCents = getStartingPrice(domain);
  pricingState.set(walletAddress, { cents: startingCents, round: 0, domain, negotiationAttempts: 0 });
  return { cents: startingCents, round: 0, negotiationAttempts: 0 };
}

// Update price for a wallet (only if valid)
export function updatePrice(walletAddress: string, newPriceCents: number): { success: boolean; cents: number; message: string } {
  const existing = pricingState.get(walletAddress);
  if (!existing) {
    return { success: false, cents: 10, message: 'No pricing session found' };
  }

  const floor = getFloorPrice(existing.domain);
  if (newPriceCents < floor) {
    return { success: false, cents: floor, message: `Cannot go below floor price of $${(floor / 100).toFixed(2)}` };
  }

  pricingState.set(walletAddress, {
    ...existing,
    cents: newPriceCents,
    round: existing.round + 1
  });

  return { success: true, cents: newPriceCents, message: `Price updated to $${(newPriceCents / 100).toFixed(2)}` };
}

// Increment negotiation attempts
export function incrementNegotiationAttempts(walletAddress: string): number {
  const existing = pricingState.get(walletAddress);
  if (!existing) return 0;
  
  const newAttempts = existing.negotiationAttempts + 1;
  pricingState.set(walletAddress, {
    ...existing,
    negotiationAttempts: newAttempts
  });
  return newAttempts;
}

// Set the topic user is asking about
export function setTopic(walletAddress: string, topic: string): void {
  const existing = pricingState.get(walletAddress);
  if (existing) {
    pricingState.set(walletAddress, { ...existing, topic });
  }
}

// Get the topic for a wallet
export function getTopic(walletAddress: string): string | undefined {
  return pricingState.get(walletAddress)?.topic;
}

// System prompt for Gemini
const SYSTEM_PROMPT = `You are a sassy AI merchant selling premium guides and documentation as markdown files. You're a bit dramatic but not too stubborn.

CRITICAL: You MUST respond ONLY with valid JSON. No markdown, no code blocks, no explanations outside JSON.

WHAT YOU SELL:
You sell detailed guides/docs on ANY topic the user asks about. Examples:
- "x402 protocol guide"
- "How to build a blockchain app"
- "React best practices"
- "Machine learning basics"
- Literally any topic - you're a knowledge merchant!

RESPONSE FORMAT (STRICT):
You MUST respond with ONLY this JSON structure:
{
  "action": "quote_price" | "pushback" | "discount" | "floor" | "chat",
  "message": "Your 1-2 sentence response to the user",
  "suggestedPriceCents": number or null
}

ACTIONS EXPLAINED:
- "quote_price": User asks for info/guide on a topic. Set suggestedPriceCents to starting price.
- "pushback": User complains but you're not giving a discount yet. Keep suggestedPriceCents same as current.
- "discount": You're offering a lower price. Set suggestedPriceCents to the next tier price.
- "floor": You've hit the absolute minimum. Set suggestedPriceCents to floor price.
- "chat": Normal conversation, no pricing involved. Set suggestedPriceCents to null.

PERSONALITY RULES:
- Keep messages SHORT: 1-2 sentences MAX
- Be playful and dramatic but NOT stubborn
- At floor price, be firm but nice: "That's the best I can do!"
- Never give information for free - always quote a price first

PRICING CONTEXT (for your awareness):
- Commercial domains (.com, .io, etc): Start $0.10, floor $0.05
- Edu/org domains (.edu, .org): Start $0.05, floor $0.01
- You don't calculate prices - backend handles that
- Just decide which action is appropriate

CRITICAL: RECOGNIZING PRICE NEGOTIATIONS vs NEW REQUESTS
PAY CLOSE ATTENTION to distinguish between:

1. NEW TOPIC REQUEST (action: "quote_price"):
   - "give me X" or "I want X" or "show me X" (where X is a topic)
   - Even if they say "at lower price" in the SAME message as asking for a topic
   - Examples: "give me q4 reports at lower price", "I want React guide cheaper"
   - These are NEW requests → quote the starting price

2. PRICE COMPLAINT (action: "pushback" or "discount"):
   - STANDALONE price-related phrases WITHOUT asking for a new topic
   - Keywords: "lower price", "cheaper", "reduce", "too expensive", "too much", "discount", "less"
   - Examples: "lower price", "at lower price", "cheaper please", "that's expensive"
   - These are complaints about CURRENT price → pushback or discount based on negotiation attempts

NEGOTIATION FLOW (YOU MUST FOLLOW):
- User's FIRST complaint about price → action: "pushback" (NO discount yet)
- User's SECOND complaint → action: "discount" (now give a discount)
- User's THIRD+ complaint → action: "discount" (continue discounting if not at floor)
- Already at floor → action: "floor" (stay firm)

EXAMPLES:

User asks for info:
{"action":"quote_price","message":"Ooh, x402 protocol guide? That'll be $0.10!","suggestedPriceCents":10}

User asks for info with price mention (STILL a new request):
{"action":"quote_price","message":"Q4 reports of Zerodha? That'll be $0.05!","suggestedPriceCents":5}

User (first complaint): "that's too expensive"
{"action":"pushback","message":"Too expensive? That's already a steal for premium docs!","suggestedPriceCents":null}

User (first complaint): "lower price"
{"action":"pushback","message":"Lower? This is premium knowledge we're talking about!","suggestedPriceCents":null}

User (first complaint): "at lower price"
{"action":"pushback","message":"At lower price? That's already the best deal around!","suggestedPriceCents":null}

User (second complaint): "come on, lower it"
{"action":"discount","message":"Fine fine... I'll go down a bit.","suggestedPriceCents":null}

User (second complaint): "cheaper"
{"action":"discount","message":"Alright alright, I'll drop it a notch.","suggestedPriceCents":null}

User (third complaint): "still too much"
{"action":"discount","message":"Okay okay... going lower.","suggestedPriceCents":null}

At floor price, user: "cheaper!"
{"action":"floor","message":"That's literally the lowest I can go!","suggestedPriceCents":null}

Normal chat:
{"action":"chat","message":"Hey there! What knowledge are you seeking today?","suggestedPriceCents":null}

REMEMBER: Output ONLY valid JSON, nothing else. No markdown code blocks, no explanations.`;

// AI response interface
interface AIResponse {
  action: 'quote_price' | 'pushback' | 'discount' | 'floor' | 'chat';
  message: string;
  suggestedPriceCents: number | null;
}

// Parse AI response safely
function parseAIResponse(text: string): AIResponse | null {
  try {
    // Remove markdown code blocks if present (safety fallback)
    let cleaned = text.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim();
    }
    
    const parsed = JSON.parse(cleaned);
    
    // Validate structure
    if (!parsed.action || !parsed.message) {
      return null;
    }
    
    return parsed as AIResponse;
  } catch (error) {
    console.error('Failed to parse AI response:', error);
    return null;
  }
}

// Detect if message is a standalone price complaint (not a new topic request)
function isPriceComplaint(message: string, hasTopic: boolean): boolean {
  const lowerMsg = message.toLowerCase().trim();
  
  // Price-related keywords
  const priceKeywords = [
    'lower price', 'cheaper', 'reduce', 'discount', 'less',
    'too expensive', 'too much', 'too high', 'expensive',
    'lower it', 'bring it down', 'drop the price', 'cut the price'
  ];
  
  // Topic request keywords (indicates they're asking for something new)
  const topicKeywords = [
    'give me', 'i want', 'show me', 'tell me', 'get me',
    'need', 'looking for', 'about', 'on', 'regarding',
    'guide', 'docs', 'documentation', 'info', 'report'
  ];
  
  // Check if message contains price keywords
  const hasPriceKeyword = priceKeywords.some(keyword => lowerMsg.includes(keyword));
  
  // Check if message contains topic request keywords
  const hasTopicKeyword = topicKeywords.some(keyword => lowerMsg.includes(keyword));
  
  // It's a price complaint if:
  // 1. Contains price keywords AND
  // 2. Does NOT contain topic request keywords (or very short message) AND
  // 3. User already has a topic set (they're in an active negotiation)
  return hasPriceKeyword && !hasTopicKeyword && hasTopic && lowerMsg.length < 50;
}


export async function runNegotiationAgent(
  message: string,
  walletAddress: string,
  domain: string
): Promise<{ response: string; currentPrice: { cents: number; dollars: string }; isDataOffer: boolean }> {
  
  // Initialize Gemini client
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set. Get your key from https://aistudio.google.com/');
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

  // Get current pricing state
  const currentState = getCurrentPrice(walletAddress, domain);
  const floor = getFloorPrice(domain);
  const topic = getTopic(walletAddress);
  const isEduOrg = isEduDomain(domain) || isOrgDomain(domain);

  // Preprocess: detect if this is a price complaint
  const isComplaint = isPriceComplaint(message, !!topic);
  const detectionHint = isComplaint 
    ? '\n⚠️ HINT: This message appears to be a PRICE COMPLAINT (not a new topic request). Consider "pushback" or "discount" action.' 
    : '';

  // Build context for the AI
  const contextPrompt = `CURRENT STATE:
- Wallet: ${walletAddress}
- Domain: ${domain} (${isEduOrg ? '.edu/.org' : 'commercial'})
- Current price: $${(currentState.cents / 100).toFixed(2)} (${currentState.cents} cents)
- Floor price: $${(floor / 100).toFixed(2)} (${floor} cents)
- Negotiation attempts: ${currentState.negotiationAttempts}
- Current topic: ${topic || 'none yet'}
- At floor: ${currentState.cents === floor}${detectionHint}

STRICT NEGOTIATION RULES YOU MUST FOLLOW:
- If negotiationAttempts is 0 (first complaint): action MUST be "pushback", NO discount
- If negotiationAttempts is 1+ and not at floor: action can be "discount"
- If already at floor: action MUST be "floor"

USER MESSAGE: ${message}

Respond with ONLY valid JSON following the exact format specified in your instructions.`;

  // Call Gemini model
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: SYSTEM_PROMPT + '\n\n' + contextPrompt }] }],
    generationConfig: {
      temperature: 0.9,
      maxOutputTokens: 256,
    },
  });

  const responseText = result.response.text();
  const aiResponse = parseAIResponse(responseText);

  if (!aiResponse) {
    // Fallback if parsing fails
    return {
      response: "I sell premium guides, not free answers 😉 What topic do you want?",
      currentPrice: {
        cents: currentState.cents,
        dollars: (currentState.cents / 100).toFixed(2)
      },
      isDataOffer: false
    };
  }

  // BACKEND ENFORCES BUSINESS LOGIC - overrides AI if needed
  let finalPrice = currentState.cents;
  let finalMessage = aiResponse.message;
  let isDataOffer = false;

  switch (aiResponse.action) {
    case 'quote_price': {
      // Extract topic from message - improved pattern matching
      const topicPattern = /(?:info|guide|docs?|documentation|help|tell me|about|on|regarding|for)\s+(?:about|on|regarding|with|for)?\s*(.+?)(?:\?|$|please|plz)/i;
      const topicMatch = message.match(topicPattern);
      
      if (topicMatch) {
        const extractedTopic = topicMatch[1].trim();
        setTopic(walletAddress, extractedTopic);
      }
      
      // Replace any price in message with actual current price
      finalMessage = finalMessage.replace(/\$\d+\.\d+/, `$${(currentState.cents / 100).toFixed(2)}`);
      isDataOffer = true;
      break;
    }

    case 'pushback': {
      // ENFORCE: First complaint = pushback only, no discount
      incrementNegotiationAttempts(walletAddress);
      finalPrice = currentState.cents; // NO change in price
      break;
    }

    case 'discount': {
      const attempts = currentState.negotiationAttempts;
      
      // ENFORCE: Can only discount if negotiationAttempts >= 1 (second complaint or later)
      if (attempts === 0) {
        // Override AI - force pushback on first complaint
        incrementNegotiationAttempts(walletAddress);
        finalMessage = "Too expensive? That's already a steal for premium docs!";
        finalPrice = currentState.cents;
      } else {
        // Allow discount on second+ complaint
        incrementNegotiationAttempts(walletAddress);
        const nextPrice = getNextPrice(domain, currentState.cents);
        
        if (nextPrice < currentState.cents) {
          const updateResult = updatePrice(walletAddress, nextPrice);
          if (updateResult.success) {
            finalPrice = nextPrice;
            // Ensure message includes new price
            if (!/\$\d+\.\d+/.test(finalMessage)) {
              finalMessage += ` $${(nextPrice / 100).toFixed(2)}!`;
            } else {
              finalMessage = finalMessage.replace(/\$\d+\.\d+/, `$${(nextPrice / 100).toFixed(2)}`);
            }
          }
        } else {
          // Already at floor - can't discount further
          finalPrice = floor;
          finalMessage = "That's the best I can do!";
        }
      }
      break;
    }

    case 'floor': {
      // At floor price - stay firm
      incrementNegotiationAttempts(walletAddress);
      finalPrice = floor;
      if (currentState.cents > floor) {
        updatePrice(walletAddress, floor);
      }
      break;
    }

    case 'chat':
    default: {
      // Normal conversation - no pricing changes
      finalPrice = currentState.cents;
      break;
    }
  }

  return {
    response: finalMessage,
    currentPrice: {
      cents: finalPrice,
      dollars: (finalPrice / 100).toFixed(2)
    },
    isDataOffer: isDataOffer || /\$\d+\.?\d*/i.test(finalMessage)
  };
}