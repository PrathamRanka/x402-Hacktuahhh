'use client'

import { PrivyProvider } from '@privy-io/react-auth'
import { base, baseSepolia } from 'viem/chains'

export default function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID

  if (!appId) {
    return (
      <div style={{ padding: '2rem', color: 'red' }}>
        Error: NEXT_PUBLIC_PRIVY_APP_ID environment variable is not set.
        <br />
        Please create a .env.local file with your Privy App ID.
      </div>
    )
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ['google', 'email'],
        appearance: {
          theme: 'dark',
          accentColor: '#10b981',
        },
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
        },
        defaultChain: baseSepolia,
        supportedChains: [base, baseSepolia],
      }}
    >
      {children}
    </PrivyProvider>
  )
}
