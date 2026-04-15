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
    contractAddress: '0x70b92a67F391F674aFFfCE3Dd7EB3d99e1f1E9a8',
  },

  base: {
    rpcUrl: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    chainId: 8453,
    contractAddress: '0xEdc6abb2f1A25A191dAf8B648c1A3686EfFE6Dd6',
  },

  nello: {
    userId: process.env.NELLO_USER_ID || '',
    apiKey: process.env.NELLO_API_KEY || '',
    callbackUrl: process.env.NELLO_CALLBACK_URL || '',
  },
});
