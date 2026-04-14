# Gigipay Backend

NestJS API server for the Gigipay protocol. Handles authentication, blockchain reads, bill payment fulfilment via ClubKonnect, and user management.

## What it does

- Authenticates users via wallet signature (SIWE-style) or Privy (email/phone)
- Issues JWTs for protected routes
- Reads on-chain state (vouchers, balances, contract paused) via viem public clients
- Builds transaction calldata for the frontend to sign
- Listens for `BillPaymentInitiated` on-chain events and fulfils orders via ClubKonnect API (airtime, data, TV, electricity)
- Stores users and bill orders in PostgreSQL

## Tech Stack

- **NestJS** — framework
- **TypeORM + PostgreSQL** — database
- **viem** — blockchain reads
- **Privy** — email/phone auth
- **Swagger** — API docs at `/api/docs`
- **Docker** — containerised deployment

## Project Structure

```
src/
├── auth/               # Wallet signature + Privy login, JWT issuance
├── users/              # User entity, profile management
├── blockchain/         # viem clients, contract reads, tx builders
├── vouchers/           # Voucher read endpoints
├── batch-transfer/     # Batch transfer tx builder endpoint
├── bills/              # Bill payment fulfilment (ClubKonnect integration)
└── config/             # Environment configuration
```

## API Modules

### Auth — `/api/auth`

| Method | Endpoint  | Description                                      |
| ------ | --------- | ------------------------------------------------ |
| GET    | `/nonce`  | Get sign-in nonce for a wallet address           |
| POST   | `/verify` | Verify wallet signature, returns JWT + user      |
| POST   | `/privy`  | Login via Privy access token, returns JWT + user |

### Users — `/api/users`

| Method | Endpoint | Description                                |
| ------ | -------- | ------------------------------------------ |
| GET    | `/me`    | Get current user profile (JWT required)    |
| POST   | `/`      | Update profile (displayName, email, phone) |

### Vouchers — `/api/vouchers`

| Method | Endpoint        | Description                            |
| ------ | --------------- | -------------------------------------- |
| GET    | `/`             | Get voucher by ID                      |
| GET    | `/by-name`      | Get voucher IDs by campaign name       |
| GET    | `/by-sender`    | Get voucher IDs by sender address      |
| GET    | `/claimable`    | Check if a voucher is claimable        |
| GET    | `/refundable`   | Check if a voucher is refundable       |
| GET    | `/paused`       | Check if contract is paused            |
| POST   | `/build/create` | Build createVoucherBatch tx calldata   |
| POST   | `/build/claim`  | Build claimVoucher tx calldata         |
| POST   | `/build/refund` | Build refundVouchersByName tx calldata |

### Batch Transfer — `/api/batch-transfer`

| Method | Endpoint  | Description                     |
| ------ | --------- | ------------------------------- |
| POST   | `/build`  | Build batchTransfer tx calldata |
| GET    | `/paused` | Check if contract is paused     |

### Bills — `/api/bills` _(coming soon)_

| Method | Endpoint     | Description                          |
| ------ | ------------ | ------------------------------------ |
| GET    | `/quote`     | Get crypto equivalent for NGN amount |
| POST   | `/pay`       | Submit bill payment order            |
| GET    | `/order/:id` | Get order status                     |

## Setup

### Prerequisites

- Node.js >= 18
- pnpm
- PostgreSQL database

### Install

```bash
pnpm install
```

### Environment

Copy the example and fill in your values:

```bash
cp .env.example .env
```

```bash
# App
PORT=3001
NODE_ENV=development

# Frontend URL (for CORS)
FRONTEND_URL=http://localhost:3000

# PostgreSQL connection string
DATABASE_URL=postgresql://user:password@localhost:5432/gigipay

# JWT — generate a strong random secret for production
JWT_SECRET=your_random_secret_here
JWT_EXPIRES_IN=7d

# Privy — get from https://privy.io dashboard
PRIVY_APP_ID=
PRIVY_APP_SECRET=

# Blockchain RPC endpoints
CELO_RPC_URL=https://rpc.ankr.com/celo
BASE_RPC_URL=https://mainnet.base.org

# ClubKonnect — get from https://clubkonnect.com (bills feature)
CLUBKONNECT_USER_ID=
CLUBKONNECT_API_KEY=
```

### Run

```bash
# development (watch mode)
pnpm run start:dev

# production
pnpm run start:prod
```

API docs available at: `http://localhost:3001/api/docs`

### Docker

```bash
docker build -t gigipay-backend .
docker run -p 3001:3001 --env-file .env gigipay-backend
```

## Authentication Flow

**Wallet (MetaMask, MiniPay, etc.):**

1. `GET /auth/nonce?address=0x...` — get a one-time nonce
2. Sign the returned message with the wallet
3. `POST /auth/verify` with address + signature + message — get JWT

**Privy (email/phone):**

1. User logs in via Privy SDK on the frontend
2. Frontend gets a Privy access token
3. `POST /auth/privy` with the access token — get JWT

All protected routes require `Authorization: Bearer <jwt>` header.

## Bill Payment Flow

1. User calls `payBill` on the contract from the frontend (wallet signs)
2. Contract emits `BillPaymentInitiated` event with orderId, buyer, token, amount, serviceType, serviceId, recipientHash
3. Backend event listener picks it up
4. Backend verifies the on-chain payment
5. Backend calls ClubKonnect API to fulfil the order
6. Order status updated in DB (pending → success / failed)
7. Failed orders flagged for refund

## Contract Addresses

| Network | Address                                      |
| ------- | -------------------------------------------- |
| Celo    | `0x70b92a67F391F674aFFfCE3Dd7EB3d99e1f1E9a8` |
| Base    | `0xEdc6abb2f1A25A191dAf8B648c1A3686EfFE6Dd6` |

These are configured in `src/blockchain/blockchain.service.ts`.
