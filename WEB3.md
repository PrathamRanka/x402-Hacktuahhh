# Web3 & Technical Terms Glossary

## A Beginner's Guide to Understanding the ZK Payment Negotiator Project

This guide explains every technical term used in this project in simple, easy-to-understand language. No prior Web3 knowledge required!

---

## 🌐 Core Web3 Concepts

### Blockchain

**What it is:** A digital ledger (like a spreadsheet) that records transactions and is shared across many computers.

**Why it matters:** Instead of one company (like a bank) controlling your money, thousands of computers work together to keep track of who owns what. No single entity can change the records.

**In this project:** We use the Base blockchain to record payments.

### Wallet

**What it is:** A digital account that holds your cryptocurrency, similar to a bank account but you control it completely.

**Key parts:**

- **Address:** Like your bank account number (e.g., `0x1234...`). You can share this publicly.
- **Private Key:** Like your password. NEVER share this! It proves you own the wallet.

**In this project:** Privy creates a wallet for you automatically when you log in with Google.

### Cryptocurrency / Crypto

**What it is:** Digital money that exists on a blockchain.

**Examples:**

- **ETH (Ethereum):** The main currency on Ethereum blockchain
- **USDC:** A "stablecoin" - always worth $1 USD

**In this project:** Users pay with USDC (digital dollars) on the Base blockchain.

### Smart Contract

**What it is:** A program that runs on the blockchain. Think of it as a vending machine - you put money in, it automatically gives you what you paid for. No human needed!

**Why it's "smart":** It executes automatically when conditions are met. No one can stop it or change the rules.

**In this project:** The x402 payment system uses smart contracts to handle payments automatically.

---

## 🔐 Zero-Knowledge Proofs (ZK)

### Zero-Knowledge Proof (ZKP)

**What it is:** A way to prove you know something WITHOUT revealing what you know.

**Real-world example:**

- **Normal proof:** "I'm a thapar student, here's my student ID showing my name and photo"
- **Zero-knowledge proof:** "I'm a thapar student" (proven cryptographically, but you don't see my name or ID)

**In this project:** You prove you have a `@thapar.edu` email without revealing your actual email address.

### ZK Circuit

**What it is:** A mathematical program that creates zero-knowledge proofs.

**Think of it as:** A recipe that takes your secret information, processes it, and outputs a proof that can be verified without revealing the secret.

**In this project:** The `jwt_domain_verifier.circom` circuit proves your email domain without exposing your email.

### Circom

**What it is:** A programming language specifically designed for writing ZK circuits.

**Why special:** Regular programming languages can't create zero-knowledge proofs. Circom is built specifically for this purpose.

**In this project:** We use Circom to write the circuit that verifies email domains.

### snarkjs

**What it is:** A JavaScript library that generates and verifies zero-knowledge proofs.

**What it does:**

1. Takes your circuit (written in Circom)
2. Generates a cryptographic proof
3. Allows others to verify the proof

**In this project:** Used to generate proofs in the browser when you log in.

### Groth16

**What it is:** A specific type of zero-knowledge proof algorithm. It's fast and produces small proofs.

**Why it matters:** Different ZK algorithms have different trade-offs. Groth16 is popular because proofs are tiny and quick to verify.

**In this project:** Our ZK proofs use the Groth16 algorithm.

### Public Signals

**What it is:** The information that IS revealed in a zero-knowledge proof.

**Example in this project:**

- **Secret (hidden):** Your email `john.doe@thapar.edu`
- **Public signals (revealed):**
  - `domainHash`: A cryptographic hash of `thapar.edu`
  - `walletBinding`: Proof your wallet belongs to a thapar email
  - `nullifier`: A unique ID to prevent reuse

**Why useful:** The server sees you're from thapar, but doesn't know who you are specifically.

### Poseidon Hash

**What it is:** A special type of hash function optimized for zero-knowledge proofs.

**What's a hash?** A function that turns any input into a fixed-size random-looking output.

- Input: `thapar.edu` → Output: `0x7a3f9b2e...` (always the same)
- Input: `thapar.edu` (with one letter changed) → Completely different output

**Why Poseidon:** Regular hash functions (like SHA-256) are slow in ZK circuits. Poseidon is designed to be fast in ZK proofs.

**In this project:** We hash email domains using Poseidon before putting them in the ZK proof.

### Nullifier

**What it is:** A unique identifier that prevents someone from using the same proof multiple times.

**Real-world analogy:** Like a concert ticket with a barcode. Once scanned, it can't be used again.

**In this project:** Prevents someone from reusing the same ZK proof to get multiple discounts.

---

## 💳 Payment & Protocol Terms

### x402 Protocol

**What it is:** A payment protocol based on HTTP status code 402 ("Payment Required").

**How it works:**

1. You request premium content
2. Server responds: "402 - Pay $0.10 to access"
3. You send payment
4. Server unlocks content

**Why it's cool:** Micropayments for any digital content, built on Web3.

**In this project:** The core payment mechanism - you negotiate a price, then pay via x402.

### HTTP 402

**What it is:** An HTTP status code that means "Payment Required".

**Background:** HTTP codes tell you what happened with a web request:

- `200` = Success
- `404` = Not Found
- `402` = Payment Required (rarely used until now!)

**In this project:** When you request premium data, the server returns 402 with payment instructions.

### USDC (USD Coin)

**What it is:** A stablecoin - a cryptocurrency that's always worth $1 USD.

**Why use it:** Regular crypto (like Bitcoin) changes in value constantly. USDC is stable, making it perfect for payments.

**How it works:** Each USDC is backed by $1 in a bank account, managed by Circle (a financial company).

**In this project:** Users pay in USDC because prices are predictable (e.g., $0.10 is always $0.10).

### Base (Blockchain)

**What it is:** A blockchain created by Coinbase, built on top of Ethereum.

**Why it exists:**

- **Ethereum:** Secure but slow and expensive
- **Base:** Fast, cheap, and still secure (inherits Ethereum's security)

**In this project:** All payments happen on Base Sepolia (the test version of Base).

### Base Sepolia

**What it is:** The test network (testnet) for Base blockchain.

**Why testnets exist:** You can test your app with fake money before using real money on the main network.

**In this project:** We use Base Sepolia so you can test payments without spending real money.

### Testnet vs Mainnet

**Testnet:**

- Fake money (free from faucets)
- For testing and development
- Mistakes don't cost real money

**Mainnet:**

- Real money
- Production use
- Mistakes cost real money!

**In this project:** We're on Base Sepolia testnet - everything is free for testing.

### Gas Fees

**What it is:** A small fee you pay to execute transactions on a blockchain.

**Why it exists:** Running code on thousands of computers costs computational power. Gas fees pay for this.

**Real-world analogy:** Like a transaction fee when you use an ATM.

**In this project:** You need a tiny bit of ETH to pay gas fees when sending USDC payments.

### Faucet

**What it is:** A website that gives you free testnet cryptocurrency.

**Why it exists:** Developers need testnet tokens to test their apps. Faucets provide them for free.

**In this project:** You use faucets to get Base Sepolia ETH and USDC for testing.

### On-Chain

**What it is:** Data or transactions that are recorded on the blockchain.

**Examples:**

- **On-chain:** A payment recorded on Base blockchain
- **Off-chain:** A message in a chat app (not on blockchain)

**Why it matters:** On-chain data is permanent, transparent, and can't be changed.

**In this project:** Payments are settled on-chain, creating a permanent record.

### Transaction Hash (txHash)

**What it is:** A unique ID for a blockchain transaction.

**Example:** `0x7f3a9b2e...`

**What you can do:** Paste it into a block explorer to see transaction details (amount, sender, receiver, timestamp).

**In this project:** After payment, you get a txHash to verify it on BaseScan (Base's block explorer).

---

## 🔑 Authentication & Identity

### OAuth

**What it is:** A standard way to log in using another service (like "Sign in with Google").

**How it works:**

1. You click "Sign in with Google"
2. Google asks: "Allow this app to access your email?"
3. You approve
4. App gets a token proving you're logged in

**In this project:** Users log in with Google OAuth via Privy.

### JWT (JSON Web Token)

**What it is:** A secure way to transmit information between parties.

**Structure:** Three parts separated by dots:

```
header.payload.signature
```

**Example use:** After Google login, you get a JWT containing your email. The signature proves it's authentic.

**In this project:** We extract your email domain from the Google JWT to create the ZK proof.

### Privy

**What it is:** A service that combines traditional login (Google, email) with Web3 wallets.

**What it does:**

1. You log in with Google
2. Privy creates a crypto wallet for you automatically
3. You don't need to manage private keys or seed phrases

**Why it's useful:** Makes Web3 accessible to non-crypto users.

**In this project:** Privy handles authentication and wallet creation.

### Embedded Wallet

**What it is:** A crypto wallet that's created and managed by a service (like Privy) instead of you managing it yourself.

**Comparison:**

- **Regular wallet (MetaMask):** You install an extension, write down a seed phrase, manage everything
- **Embedded wallet (Privy):** Created automatically when you log in, managed securely by Privy

**In this project:** Privy creates an embedded wallet when you sign in with Google.

### MetaMask

**What it is:** A browser extension that acts as a crypto wallet.

**What it does:**

- Stores your private keys
- Lets you interact with blockchain apps
- Sign transactions

**In this project:** We DON'T use MetaMask - we use Privy's embedded wallets instead (easier for users).

---

## 🏗️ Technical Infrastructure

### Coinbase Developer Platform (CDP)

**What it is:** A set of tools from Coinbase to build blockchain applications.

**What it provides:**

- Create and manage wallets programmatically
- Send and receive crypto
- Interact with smart contracts

**In this project:** The server uses CDP to create a wallet that receives payments.

### MongoDB Atlas

**What it is:** A cloud database service (like Google Sheets but for apps).

**What it stores:** Structured data in "documents" (similar to JSON objects).

**In this project:** Stores nullifiers (to prevent proof reuse) and tracks user sessions.

### Express.js

**What it is:** A framework for building web servers in JavaScript/Node.js.

**What it does:** Handles HTTP requests, routes, and API endpoints.

**In this project:** The backend server that handles chat, pricing, and payment verification.

### Next.js

**What it is:** A framework for building React web applications.

**Why use it:** Makes it easy to build fast, modern web apps with server-side rendering.

**In this project:** The frontend (what you see in the browser) is built with Next.js.

### API (Application Programming Interface)

**What it is:** A way for different software to communicate.

**Real-world analogy:** Like a waiter in a restaurant:

- You (frontend) tell the waiter (API) what you want
- Waiter tells the kitchen (backend)
- Kitchen prepares food and sends it back through the waiter

**In this project:** The frontend calls backend APIs to chat with the AI, verify proofs, and process payments.

### Environment Variables (.env)

**What it is:** Configuration settings stored in a file, not in your code.

**Why use them:**

- Keep secrets (API keys) out of your code
- Different settings for development vs production

**Example:**

```
ANTHROPIC_API_KEY=sk-ant-...
MONGODB_URI=mongodb+srv://...
```

**In this project:** API keys for Anthropic, MongoDB, Privy, and CDP are stored in `.env` files.

---

## 🤖 AI & Agent Terms

### Anthropic Claude

**What it is:** An AI assistant (like ChatGPT) created by Anthropic.

**In this project:** Powers the negotiation agent that chats with users and adjusts prices.

### AI Agent

**What it is:** An AI that can take actions, not just answer questions.

**Difference:**

- **Regular AI:** "What's the weather?" → "It's sunny"
- **AI Agent:** "Book me a flight" → AI searches, compares prices, books ticket

**In this project:** The negotiation agent can:

- Chat with users
- Check current prices
- Adjust prices based on negotiation
- Remember conversation context

### Tool Use / Function Calling

**What it is:** The ability for an AI to call specific functions to take actions.

**Example tools in this project:**

- `get_price`: Check current price for a wallet
- `update_price`: Change the price after negotiation
- `set_topic`: Remember what guide the user wants

**How it works:**

1. User: "Can you lower the price?"
2. AI decides to call `get_next_tier_price` tool
3. Tool returns: "$0.07"
4. AI responds: "Okay, I'll do $0.07!"

---

## 📊 Project-Specific Terms

### Domain Hash

**What it is:** A cryptographic hash of your email domain (e.g., `thapar.edu`).

**Why hash it:** Hashing makes it impossible to reverse-engineer the original domain from the hash alone.

**In this project:** The ZK proof reveals the domain hash, not the actual domain name.

### Wallet Binding

**What it is:** Cryptographic proof that a specific wallet address belongs to a specific email domain.

**Why it matters:** Prevents someone from using your proof with their wallet.

**In this project:** The ZK proof binds your Privy wallet to your Google email domain.

### Negotiation State

**What it is:** Information about the current price negotiation for each user.

**What it tracks:**

- Current price
- Number of negotiation rounds
- Topic the user wants
- User's domain

**In this project:** Stored in memory on the backend to remember conversation context.

### Pricing Tiers

**What it is:** Different price levels based on user identity.

**Example tiers in this project:**

- **Students (.edu domains):** $0.10 → $0.07 → $0.05
- **Organizations (.org):** $0.15 → $0.12 → $0.10
- **Enterprises (.com):** $0.25 → $0.20 → $0.15

**Why tiers:** Allows dynamic pricing based on verified identity.

### Mock Mode vs Real Mode

**Mock Mode:**

- Generates fake ZK proofs (structure is correct, but not cryptographically valid)
- No circom installation needed
- Perfect for UI testing

**Real Mode:**

- Generates real cryptographic ZK proofs
- Requires circom to be installed
- Proofs can be verified on-chain

**In this project:** Runs in mock mode by default for easier development.

---

## 🛠️ Development Tools

### pnpm

**What it is:** A package manager for JavaScript (like npm or yarn).

**What it does:** Installs libraries and dependencies your project needs.

**Why pnpm:** Faster and uses less disk space than npm.

**In this project:** Used to install all dependencies and run the dev servers.

### TypeScript

**What it is:** JavaScript with type checking.

**Example:**

```javascript
// JavaScript (no types)
function add(a, b) { return a + b }

// TypeScript (with types)
function add(a: number, b: number): number { return a + b }
```

**Why use it:** Catches bugs before you run the code.

**In this project:** Both frontend and backend are written in TypeScript.

### Concurrently

**What it is:** A tool to run multiple commands at the same time.

**In this project:** Runs both frontend and backend servers with one command: `pnpm run dev`

### Makefile

**What it is:** A file that defines shortcuts for common commands.

**Example:**

```makefile
dev:
    pnpm run dev
```

**Problem:** `make` is a Unix command - doesn't work on Windows PowerShell!

**In this project:** The Makefile is for Mac/Linux users. Windows users should use `pnpm` commands directly.

---

## 🔗 Network & Protocol Terms

### EIP-155

**What it is:** A standard for identifying different Ethereum-compatible blockchains.

**Format:** `eip155:chainId`

- `eip155:1` = Ethereum Mainnet
- `eip155:8453` = Base Mainnet
- `eip155:84532` = Base Sepolia Testnet

**In this project:** We specify `eip155:84532` to indicate Base Sepolia.

### Block Explorer

**What it is:** A website where you can view blockchain transactions and addresses.

**Examples:**

- **Etherscan:** For Ethereum
- **BaseScan:** For Base blockchain

**What you can see:**

- Transaction history
- Wallet balances
- Smart contract code

**In this project:** After payment, you can view the transaction on BaseScan.

### RPC (Remote Procedure Call)

**What it is:** A way for your app to communicate with the blockchain.

**Think of it as:** A phone line to the blockchain. You call it to send transactions or read data.

**In this project:** Privy and CDP use RPC endpoints to interact with Base Sepolia.

---

## 🎯 Why This All Matters

This project combines multiple cutting-edge technologies to solve a real problem:

**The Problem:** How do you offer personalized pricing (students get discounts, enterprises pay more) while protecting user privacy?

**The Solution:**

1. **Zero-Knowledge Proofs:** Prove your identity category (student, enterprise) without revealing who you are
2. **AI Negotiation:** Dynamic pricing through conversation
3. **Web3 Payments:** Instant, programmable payments with USDC
4. **x402 Protocol:** Standardized way to gate content behind payments

**The Result:** A privacy-preserving, identity-aware payment system where your identity determines your price, but your identity stays private.

---

## 📚 Quick Reference

### Key Files in This Project

- **`circuits/jwt_domain_verifier.circom`**: ZK circuit that proves email domain
- **`frontend/lib/zkproof.ts`**: Generates ZK proofs in the browser
- **`backend/src/agent/negotiationAgent.ts`**: AI agent that negotiates prices
- **`frontend/app/api/route.ts`**: x402 payment endpoint
- **`.env` files**: Store API keys and configuration

### Important URLs

- **Privy Dashboard:** https://dashboard.privy.io
- **Anthropic Console:** https://console.anthropic.com
- **Base Sepolia Faucet:** https://portal.cdp.coinbase.com/products/faucet
- **BaseScan (Testnet):** https://sepolia.basescan.org

### Common Commands (Windows)

```powershell
# Install dependencies
pnpm run install:all

# Start both servers
pnpm run dev

# Start only frontend
pnpm run dev:frontend

# Start only backend
pnpm run dev:backend
```

---

## 🎓 Learning Path

If you want to learn more about these technologies:

1. **Start with:** Blockchain basics, wallets, transactions
2. **Then learn:** Smart contracts, Ethereum, Base
3. **Next:** Zero-knowledge proofs (conceptually)
4. **Advanced:** Circom, ZK circuits, cryptography

**Resources:**

- **Blockchain:** ethereum.org/en/developers/docs
- **ZK Proofs:** zkp.science
- **Base:** docs.base.org
- **Privy:** docs.privy.io

---

_This glossary covers all major technical terms in the ZK Payment Negotiator project. If you encounter a term not listed here, feel free to ask!_
