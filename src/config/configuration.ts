export default () => ({
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  DATABASE_URL: process.env.DATABASE_URL,

  jwt: {
    secret: process.env.JWT_SECRET || 'changeme',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },

  privy: {
    appId: process.env.PRIVY_APP_ID || '',
    appSecret: process.env.PRIVY_APP_SECRET || '',
  },

  celo: {
    rpcUrl: process.env.CELO_RPC_URL || 'https://rpc.ankr.com/celo',
    chainId: 42220,
    contractAddress: '0x79aB973f8985755dC7E185fcd0F60888e46019a3', // Gigipay v2.0 (redeployed 2026-07-21, Safe admin)
  },

  // Celo Sepolia testnet — build & test the AI agent here first (mainnet is real money).
  // No contract deployed yet: set CONTRACT_ADDRESS_CELO_SEPOLIA once you deploy.
  celoSepolia: {
    rpcUrl:
      process.env.CELO_SEPOLIA_RPC_URL || 'https://forno.celo-sepolia.celo-testnet.org',
    chainId: 11142220,
    contractAddress: process.env.CONTRACT_ADDRESS_CELO_SEPOLIA || '',
  },

  base: {
    rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    chainId: 8453,
    contractAddress: '0xEdc6abb2f1A25A191dAf8B648c1A3686EfFE6Dd6',
  },

  // Default chain the AI agent operates on. Targets Celo MAINNET (42220) — real
  // money. Every agent transaction is user-signed in their own wallet and gated
  // by maxSpendUsd; the agent never holds keys or moves funds itself.
  // Set AGENT_DEFAULT_CHAIN_ID=11142220 to point it at Celo Sepolia for testing.
  agent: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.AGENT_MODEL || 'claude-opus-4-8',
    defaultChainId: parseInt(process.env.AGENT_DEFAULT_CHAIN_ID || '42220', 10),
    maxSpendUsd: parseFloat(process.env.AGENT_MAX_SPEND_USD || '50'),
  },

  nello: {
    userId: process.env.NELLO_USER_ID || '',
    apiKey: process.env.NELLO_API_KEY || '',
    callbackUrl: process.env.NELLO_CALLBACK_URL || '',
  },

  coingecko: {
    apiKey: process.env.COINGECKO_API_KEY || '',
  },

  // Web Push (VAPID) — notifies users when a scheduled payment run is due.
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@gigipay.app',
  },
});
