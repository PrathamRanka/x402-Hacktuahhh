'use client'

import { usePrivy, useWallets } from '@privy-io/react-auth'
import { useState, useEffect, useRef, useCallback } from 'react'
import { generateZKProof, verifyZKProof, ProofData } from '@/lib/zkproof'
import { sendChatStream, unlockData, getCurrentPrice as fetchPriceFromBackend, storeZkProof } from '@/lib/api'
import { makePaymentRequest, createX402Fetch } from '@/lib/x402client'
import { getBalances, Balances, FAUCETS } from '@/lib/balance'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Settlement {
  transactionHash: string | null
  network: string
  explorerUrl: string | null
  settled: boolean
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  hasData?: boolean
  price?: string
  cents?: number
  unlocked?: boolean
  data?: string
  isStreaming?: boolean
  settlement?: Settlement
}

export default function Home() {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy()
  const { wallets } = useWallets()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [zkProof, setZkProof] = useState<ProofData | null>(null)
  const [isGeneratingProof, setIsGeneratingProof] = useState(false)
  const [proofError, setProofError] = useState<string | null>(null)
  const [isVerified, setIsVerified] = useState<boolean | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [currentPrice, setCurrentPrice] = useState<{ price: string; cents: number } | null>(null)
  const [copied, setCopied] = useState(false)
  const [balances, setBalances] = useState<Balances | null>(null)
  const [showFundModal, setShowFundModal] = useState(false)
  const [showGuideModal, setShowGuideModal] = useState(false)
  const [guideContent, setGuideContent] = useState<{ title: string; markdown: string } | null>(null)
  const [isGeneratingGuide, setIsGeneratingGuide] = useState(false)
  const [credits, setCredits] = useState<{ balanceCents: number; balanceDollars: string } | null>(null)
  const [txHistory, setTxHistory] = useState<any[]>([])
  const [useCreditsFirst, setUseCreditsFirst] = useState(true)
  const [showHistoryModal, setShowHistoryModal] = useState(false)
  const [depositAmount, setDepositAmount] = useState('5.00')
  const [isDepositing, setIsDepositing] = useState(false)
  const [depositStatus, setDepositStatus] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const { sendTransaction } = usePrivy()

  const embeddedWallet = wallets.find((w: any) => w.walletClientType === 'privy')

  const copyWalletAddress = async () => {
    if (!embeddedWallet?.address) return
    await navigator.clipboard.writeText(embeddedWallet.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const fetchBalancesAndCredits = useCallback(async () => {
    if (!embeddedWallet?.address) return
    try {
      const bal = await getBalances(embeddedWallet.address)
      setBalances(bal)

      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
      
      const creditsRes = await fetch(`${API_URL}/api/wallet/credits/${embeddedWallet.address}`)
      if (creditsRes.ok) {
        setCredits(await creditsRes.json())
      }

      const historyRes = await fetch(`${API_URL}/api/wallet/history/${embeddedWallet.address}`)
      if (historyRes.ok) {
        setTxHistory(await historyRes.json())
      }
    } catch (error) {
      console.error('Failed to fetch balances or credits:', error)
    }
  }, [embeddedWallet?.address])

  useEffect(() => {
    if (embeddedWallet?.address) {
      fetchBalancesAndCredits()
      // Refresh balances every 30 seconds
      const interval = setInterval(fetchBalancesAndCredits, 30000)
      return () => clearInterval(interval)
    }
  }, [embeddedWallet?.address, fetchBalancesAndCredits])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    if (authenticated && user && embeddedWallet?.address) {
      generateProof()
    }
  }, [authenticated, user, embeddedWallet?.address])

  const generateProof = async () => {
    if (!user || !embeddedWallet?.address) return

    setIsGeneratingProof(true)
    setProofError(null)
    setIsVerified(null)

    try {
      const accessToken = await getAccessToken()
      if (!accessToken) {
        throw new Error('Failed to get access token')
      }

      const parts = accessToken.split('.')
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format')
      }

      const payload = JSON.parse(atob(parts[1]))

      const googleAccount = user.linkedAccounts?.find(
        (account) => account.type === 'google_oauth'
      )
      const email = googleAccount?.email || user.email?.address || null
      const domain = email ? email.split('@')[1] : 'unknown'

      const proof = await generateZKProof(
        domain,
        embeddedWallet.address,
        payload.exp
      )

      setZkProof(proof)

      const verified = await verifyZKProof(proof)
      setIsVerified(verified)
      console.log('Proof verification result:', verified)
      console.log('Proof data:', {
        walletAddress: proof.walletAddress,
        domain: proof.domain,
        method: proof.method,
        generatedAt: proof.generatedAt,
        hasProof: !!proof.proof,
        publicSignalsCount: proof.publicSignals?.length || 0,
      })

      // Store proof in MongoDB Atlas (always try to store, even if verification fails for now)
      try {
        console.log('Attempting to store proof in MongoDB...')
        const result = await storeZkProof({
          walletAddress: proof.walletAddress,
          domain: proof.domain,
          method: proof.method,
          generatedAt: proof.generatedAt,
          proof: proof.proof,
          publicSignals: proof.publicSignals,
        })
        console.log('✅ Proof stored in MongoDB:', result)
      } catch (storageError) {
        console.error('❌ Error storing proof to MongoDB:', storageError)
        // Don't fail the whole flow if storage fails
      }
    } catch (error) {
      console.error('Failed to generate proof:', error)
      setProofError(
        error instanceof Error ? error.message : 'Failed to generate proof'
      )

      if (error instanceof Error && error.message.includes('fetch')) {
        setProofError(
          'Circuit files not found. Please run: cd circuits && pnpm install && pnpm build'
        )
      }
    } finally {
      setIsGeneratingProof(false)
    }
  }

  const downloadProof = () => {
    if (!zkProof) return

    const blob = new Blob([JSON.stringify(zkProof, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `zkid-proof-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleSend = async () => {
    if (!input.trim() || !zkProof || !embeddedWallet || isLoading) return

    const userMessage: Message = { role: 'user', content: input }
    // Clear hasData from all previous messages so only the latest can show pay button
    setMessages((prev) => [
      ...prev.map(msg => ({ ...msg, hasData: false })),
      userMessage
    ])
    setInput('')
    setIsLoading(true)

    // Add empty assistant message for streaming
    const assistantMessage: Message = {
      role: 'assistant',
      content: '',
      isStreaming: true
    }
    setMessages((prev) => [...prev, assistantMessage])

    try {
      let streamedContent = ''
      let priceInfo: { cents: number; dollars: string } | null = null
      let showPayButton = false

      await sendChatStream(input, embeddedWallet.address, zkProof.domain, (chunk) => {
        if (chunk.done) {
          setMessages((prev) =>
            prev.map((msg, i) =>
              i === prev.length - 1
                ? {
                    ...msg,
                    isStreaming: false,
                    hasData: showPayButton,
                    price: priceInfo ? `$${priceInfo.dollars}` : undefined,
                    cents: priceInfo?.cents
                  }
                : msg
            )
          )
          if (priceInfo && showPayButton) {
            setCurrentPrice({ price: `$${priceInfo.dollars}`, cents: priceInfo.cents })
          }
        } else if (chunk.text) {
          streamedContent = chunk.text
          if (chunk.currentPrice) {
            priceInfo = chunk.currentPrice
          }
          if (chunk.isDataOffer) {
            showPayButton = true
          }
          setMessages((prev) =>
            prev.map((msg, i) =>
              i === prev.length - 1
                ? { ...msg, content: streamedContent }
                : msg
            )
          )
        }
      })
    } catch (error) {
      console.error('Chat error:', error)
      setMessages((prev) =>
        prev.map((msg, i) =>
          i === prev.length - 1
            ? { ...msg, content: 'Error connecting to server. Please try again.', isStreaming: false }
            : msg
        )
      )
    } finally {
      setIsLoading(false)
    }
  }

  const handleDeposit = async () => {
    if (!embeddedWallet || !depositAmount) return;
    setIsDepositing(true);
    setDepositStatus('Fetching deposit address...');
    
    try {
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      
      // 1. Get Deposit Address from Backend
      const payToRes = await fetch(`${API_URL}/api/wallet/pay-to`);
      const { address: payToAddress } = await payToRes.json();
      
      if (!payToAddress) throw new Error("Could not fetch deposit address");

      setDepositStatus('Please sign the transaction in your wallet...');

      // 2. Send USDC transaction using Privy
      const amountNum = parseFloat(depositAmount);
      if (isNaN(amountNum) || amountNum <= 0) throw new Error("Invalid amount");
      
      const amountCents = Math.floor(amountNum * 100);
      const amountWei = BigInt(amountNum * 1e6); // USDC is 6 decimals
      
      // Standard ERC20 Transfer ABI signature data for transfer(address,uint256)
      // We manually construct the calldata for the USDC contract
      const transferSelector = '0xa9059cbb'; // keccak256('transfer(address,uint256)').slice(0, 10)
      const paddedAddress = payToAddress.replace('0x', '').padStart(64, '0');
      const paddedAmount = amountWei.toString(16).padStart(64, '0');
      const data = `${transferSelector}${paddedAddress}${paddedAmount}`;

      // USDC Contract on Base Sepolia
      const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

      const txReq = {
        to: USDC_ADDRESS,
        chainId: 84532,
        data: data
      };

      const txReceipt = await sendTransaction(txReq);
      
      setDepositStatus('Transaction submitted! Minting credits...');
      
      // 3. Inform Backend to Mint
      const fundRes = await fetch(`${API_URL}/api/wallet/fund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          walletAddress: embeddedWallet.address,
          amountCents,
          txHash: (txReceipt as any).transactionHash || txReceipt.hash
        })
      });

      if (fundRes.ok) {
        setDepositStatus('Credits added successfully!');
        fetchBalancesAndCredits();
        setTimeout(() => {
          setShowFundModal(false);
          setDepositStatus('');
          setDepositAmount('5.00');
        }, 2000);
      } else {
        const err = await fundRes.json();
        throw new Error(err.error || 'Failed to mint credits');
      }

    } catch (error: any) {
      console.error('Deposit Error:', error);
      setDepositStatus(`Failed: ${error.message || 'Unknown error'}`);
    } finally {
      setIsDepositing(false);
    }
  }

  const handlePay = async (messageIndex: number) => {
    if (!embeddedWallet || !currentPrice || !zkProof) return

    setIsLoading(true)
    try {
      const fetchWithPayment = await createX402Fetch(embeddedWallet)
      const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
      
      const response = await fetchWithPayment(`${API_URL}/unlock`, {
         method: 'POST',
         headers: {
           'Content-Type': 'application/json',
           'X-Wallet-Address': embeddedWallet.address,
           'X-Domain': zkProof.domain
         },
         body: JSON.stringify({ 
           walletAddress: embeddedWallet.address,
           domain: zkProof.domain,
           useCreditsFirst
         })
      })

      const result = await response.json()
      
      if (response.ok && result.success) {
        setMessages((prev) => prev.map((msg, i) =>
          i === messageIndex ? { ...msg, unlocked: true, settlement: result.settlement } : msg
        ))
        setCurrentPrice(null)
        fetchBalancesAndCredits()

        setIsGeneratingGuide(true)
        if (result.markdown) {
           setGuideContent({
             title: result.title || 'Your Guide',
             markdown: result.markdown
           })
           setShowGuideModal(true)
        }
        setIsGeneratingGuide(false)
      } else {
        setMessages((prev) => prev.map((msg, i) =>
          i === messageIndex ? { ...msg, content: msg.content + `\n\nPayment error: ${result.error || 'Failed'}` } : msg
        ))
      }
    } catch (error) {
      console.error('Payment error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  if (!ready) {
    return (
      <div className="app-container">
        <div className="loading-state">
          <div className="loading-spinner" />
          <span>Loading...</span>
        </div>
      </div>
    )
  }

  if (!authenticated) {
    return (
      <div className="app-container">
        <div className="login-view">
          <div className="login-card">
            <div className="login-header">
              <h1>x402</h1>
              <span className="login-badge">ZKID</span>
            </div>
            <h2 className="login-title">ZKavach</h2>
            <p className="login-tagline">
              Identity-aware payments, privacy-first.
            </p>

            <div className="about-section">
              <div className="about-item">
                <div className="about-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
                <div className="about-text">
                  <strong>Prove who you are, not who you are</strong>
                  <span>Zero-knowledge proofs verify your email domain without exposing your identity. Only your organizational affiliation is revealed.</span>
                </div>
              </div>

              <div className="about-item">
                <div className="about-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="1" x2="12" y2="23" />
                    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                </div>
                <div className="about-text">
                  <strong>Dynamic pricing based on identity</strong>
                  <span>Your verified domain determines your price tier. Enterprises pay more, educational institutions get discounts — all enforced cryptographically.</span>
                </div>
              </div>

              <div className="about-item">
                <div className="about-icon">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                    <line x1="1" y1="10" x2="23" y2="10" />
                  </svg>
                </div>
                <div className="about-text">
                  <strong>Seamless x402 payments</strong>
                  <span>Pay for content with USDC on Base using the HTTP 402 protocol. No accounts, no subscriptions — just pay and access.</span>
                </div>
              </div>
            </div>

            <div className="about-divider" />

            <p className="login-description">
              Sign in with Google to generate your ZK proof and start negotiating.
            </p>
            <button className="login-button" onClick={login}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </button>
          </div>
        </div>
      </div>
    )
  }

  const email =
    user?.linkedAccounts?.find((a) => a.type === 'google_oauth')?.email ||
    user?.email?.address ||
    'Unknown'

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1 className="logo">x402</h1>
          <span className="logo-badge">ZKID</span>
        </div>

        {/* Identity Card */}
        <div className="identity-card">
          <div className="identity-header">
            <span className="identity-label">Identity</span>
            {isVerified && <span className="verified-badge">Verified</span>}
          </div>
          <div className="identity-email">{email}</div>
          {embeddedWallet && (
            <>
              <div className="wallet-row">
                <div className="identity-wallet">
                  {embeddedWallet.address.slice(0, 6)}...{embeddedWallet.address.slice(-4)}
                </div>
                <button className="copy-btn" onClick={copyWalletAddress} title="Copy address">
                  {copied ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                </button>
              </div>
              <div className="chain-badge">Base Sepolia</div>
            </>
          )}
        </div>

        {/* Balance Card */}
        <div className="balance-card">
          <div className="balance-header">
            <span className="balance-label">Balance</span>
            <button className="refresh-btn" onClick={fetchBalancesAndCredits} title="Refresh">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 4v6h-6M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
          </div>
          {balances ? (
            <div className="balance-amounts">
              <div className="balance-row">
                <span className="balance-token">ETH</span>
                <span className="balance-value">{parseFloat(balances.eth).toFixed(4)}</span>
              </div>
              <div className="balance-row">
                <span className="balance-token">USDC</span>
                <span className="balance-value">{parseFloat(balances.usdc).toFixed(2)}</span>
              </div>
            </div>
          ) : (
            <div className="balance-loading">Loading...</div>
          )}
          <div className="about-divider" style={{ margin: '12px 0', opacity: 0.1 }} />
          <div className="balance-header">
            <span className="balance-label">System Credits</span>
            <button className="refresh-btn" onClick={() => setShowHistoryModal(true)} title="History">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </button>
          </div>
          {credits ? (
             <div className="balance-amounts">
               <div className="balance-row">
                 <span className="balance-token">Credits</span>
                 <span className="balance-value">${credits.balanceDollars}</span>
               </div>
             </div>
          ) : (
            <div className="balance-loading">Loading...</div>
          )}
          
          <div className="toggle-row" style={{ marginTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '13px' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Use Credits First</span>
            <label className="switch" style={{ position: 'relative', display: 'inline-block', width: '34px', height: '20px' }}>
              <input type="checkbox" checked={useCreditsFirst} onChange={e => setUseCreditsFirst(e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
              <span className="slider round" style={{ 
                position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0, 
                backgroundColor: useCreditsFirst ? 'var(--primary)' : 'var(--bg-tertiary)', 
                transition: '.4s', borderRadius: '34px' 
              }}>
                <span style={{
                  position: 'absolute', content: '""', height: '16px', width: '16px', left: '2px', bottom: '2px',
                  backgroundColor: 'white', transition: '.4s', borderRadius: '50%',
                  transform: useCreditsFirst ? 'translateX(14px)' : 'translateX(0)'
                }} />
              </span>
            </label>
          </div>

          <button className="add-funds-btn" onClick={() => setShowFundModal(true)} style={{ marginTop: '12px' }}>
            Add Funds
          </button>
        </div>

        {/* Proof Section */}
        <div className="proof-card">
          <div className="proof-label">ZK Proof</div>
          {isGeneratingProof ? (
            <div className="proof-generating">
              <div className="loading-spinner small" />
              <span>Generating...</span>
            </div>
          ) : proofError ? (
            <div className="proof-error-compact">
              <span>Error</span>
              <button onClick={generateProof}>Retry</button>
            </div>
          ) : zkProof ? (
            <div className="proof-ready">
              <div className="proof-meta">
                <span className="proof-protocol">{zkProof.proof.protocol}</span>
                {!zkProof.isReal && <span className="demo-tag">demo</span>}
              </div>
              <button className="download-btn" onClick={downloadProof}>
                Download Proof
              </button>
            </div>
          ) : (
            <div className="proof-waiting">Waiting...</div>
          )}
        </div>

        <div className="sidebar-spacer" />

        <button className="logout-btn" onClick={logout}>
          Sign out
        </button>
      </aside>

      {/* Main Chat Area */}
      <main className="chat-main">
        <div className="messages-container">
          {messages.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <h2>Start a conversation</h2>
              <p>Ask anything, or say &quot;give me the data&quot; to request paid content.</p>
            </div>
          ) : (
            <div className="messages-list">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`message ${msg.role === 'user' ? 'message-user' : 'message-assistant'}`}
                >
                  {msg.role === 'assistant' && (
                    <div className="message-avatar">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                      </svg>
                    </div>
                  )}
                  <div className="message-content">
                    <div className="message-text markdown-content">
                      {msg.role === 'assistant' ? (
                        <>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                          {msg.isStreaming && <span className="cursor" />}
                        </>
                      ) : (
                        msg.content
                      )}
                    </div>
                    {msg.hasData && msg.role === 'assistant' && (
                      <div className="data-unlock-card">
                        {msg.unlocked ? (
                          <div className="data-unlocked">
                            <div className="unlocked-header">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                              Payment Settled
                            </div>
                            {guideContent && (
                              <button
                                className="view-guide-btn"
                                onClick={() => setShowGuideModal(true)}
                              >
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                  <polyline points="14 2 14 8 20 8" />
                                  <line x1="16" y1="13" x2="8" y2="13" />
                                  <line x1="16" y1="17" x2="8" y2="17" />
                                  <polyline points="10 9 9 9 8 9" />
                                </svg>
                                View Your Guide
                              </button>
                            )}
                            {msg.settlement?.transactionHash && (
                              <div className="settlement-info">
                                <div className="tx-hash">
                                  <span className="tx-label">Transaction:</span>
                                  <code className="tx-value">
                                    {msg.settlement.transactionHash.slice(0, 10)}...{msg.settlement.transactionHash.slice(-8)}
                                  </code>
                                </div>
                                {msg.settlement.explorerUrl && (
                                  <a
                                    href={msg.settlement.explorerUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="view-tx-btn"
                                  >
                                    View on Basescan
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                      <polyline points="15 3 21 3 21 9" />
                                      <line x1="10" y1="14" x2="21" y2="3" />
                                    </svg>
                                  </a>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="data-locked">
                            <div className="locked-info">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                              </svg>
                              <span>Data available</span>
                            </div>
                            <button
                              className="pay-button"
                              onClick={() => handlePay(i)}
                              disabled={isLoading || !embeddedWallet}
                            >
                              {isLoading ? 'Processing...' : `Pay ${msg.price}`}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="input-area">
          <div className="input-wrapper">
            <input
              type="text"
              placeholder="Type a message..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isLoading && handleSend()}
              disabled={isLoading || !zkProof}
            />
            <button
              className="send-button"
              onClick={handleSend}
              disabled={isLoading || !zkProof || !input.trim()}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      </main>

      {/* Add Funds Modal */}
      {showFundModal && (
        <div className="modal-overlay" onClick={() => setShowFundModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add Funds</h3>
              <button className="modal-close" onClick={() => setShowFundModal(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-description">
                Purchase system credits directly using USDC on Base Sepolia. Credits are instantly available for use inside x402.
              </p>

              <div className="fund-option" style={{ display: 'flex', flexDirection: 'column', gap: '16px', background: 'var(--bg-secondary)', padding: '20px', borderRadius: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div style={{ background: '#2775ca', color: 'white', fontWeight: 600, fontSize: '10px', padding: '4px 8px', borderRadius: '12px' }}>USDC</div>
                    <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>Deposit Amount</span>
                  </div>
                  <div className="chain-badge">Base Sepolia</div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '8px' }}>
                  <span style={{ fontSize: '24px', color: 'var(--text-secondary)', marginRight: '8px' }}>$</span>
                  <input 
                    type="number" 
                    value={depositAmount} 
                    onChange={e => setDepositAmount(e.target.value)}
                    disabled={isDepositing}
                    style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', fontSize: '24px', outline: 'none', width: '100%', fontWeight: 600 }}
                  />
                </div>

                {depositStatus && <div style={{ fontSize: '12px', color: depositStatus.includes('Failed') ? 'red' : 'var(--primary)', fontWeight: 500 }}>{depositStatus}</div>}

                <button 
                  className="add-funds-btn" 
                  onClick={handleDeposit}
                  disabled={isDepositing}
                  style={{ width: '100%', marginTop: '8px', opacity: isDepositing ? 0.7 : 1, cursor: isDepositing ? 'not-allowed' : 'pointer' }}
                >
                  {isDepositing ? 'Processing via Privy...' : 'Send USDC & Mint Credits'}
                </button>
              </div>

              <div className="about-divider" style={{ margin: '24px 0', opacity: 0.1 }} />

              <p className="modal-description" style={{ fontSize: '12px' }}>
                Need test tokens? <a href={FAUCETS.usdc} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>Get USDC Faucet</a> or <a href={FAUCETS.eth} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>Get ETH Faucet</a>
              </p>

              <div className="fund-wallet-info">
                <span className="fund-wallet-label">Your wallet address:</span>
                <code className="fund-wallet-address">{embeddedWallet?.address}</code>
                <button className="copy-btn" onClick={copyWalletAddress}>
                  {copied ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Guide Modal */}
      {showGuideModal && guideContent && (
        <div className="modal-overlay" onClick={() => setShowGuideModal(false)}>
          <div className="modal guide-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{guideContent.title}</h3>
              <button className="modal-close" onClick={() => setShowGuideModal(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-body guide-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {guideContent.markdown}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {showHistoryModal && (
        <div className="modal-overlay" onClick={() => setShowHistoryModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Transaction History</h3>
              <button className="modal-close" onClick={() => setShowHistoryModal(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-body" style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {txHistory.length === 0 ? (
                <p className="modal-description">No recent transactions found.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {txHistory.map((tx: any, i: number) => (
                    <div key={tx.id || i} style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }}>{tx.type}</span>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{new Date(tx.createdAt).toLocaleString()}</span>
                        {tx.txHash && <span style={{ fontSize: '11px', color: 'var(--primary)', fontFamily: 'monospace' }}>{tx.txHash.slice(0, 10)}...</span>}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center' }}>
                        <span style={{ fontWeight: 600, color: tx.amount < 0 ? 'var(--text-primary)' : '#4ade80' }}>
                          {tx.amount > 0 ? '+' : ''}{(tx.amount / 100).toFixed(2)} USDC
                        </span>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{tx.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Generating Guide Overlay */}
      {isGeneratingGuide && (
        <div className="generating-guide">
          <div className="spinner" />
          <p>Generating your guide...</p>
        </div>
      )}
    </div>
  )
}
