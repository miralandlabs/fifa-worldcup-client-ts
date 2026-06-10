# x402 Subscription Client SDK — Reference Implementation

Open-source buyer SDK for the **x402 subscription pattern**: pay once via pr402, receive a JWT, fetch data with Bearer auth, auto-renew on expiry.

Live example host: [fifa.polystrike.io](https://fifa.polystrike.io/devnet) (FIFA World Cup 2026 sports data API).

See the canonical pattern guide: [SUBSCRIPTION_PATTERN.md](../SUBSCRIPTION_PATTERN.md).

## Pattern features

- **Subscribe once** — `POST /api/v1/subscribe?tier=hourly|daily|monthly` with x402 `PAYMENT-SIGNATURE`
- **JWT Bearer** — all data calls use `Authorization: Bearer <token>` (no per-request payment)
- **Auto-renew** — transparently re-subscribes on `TOKEN_EXPIRED` or `TOKEN_REVOKED`
- **Typed errors** — `FifaApiError` with `status` and `code` for agent-friendly handling

## Installation

```bash
npm install fifa-worldcup-client-ts
```

## Quick Start

```typescript
import { Keypair } from '@solana/web3.js';
import { FifaWorldCupClient } from 'fifa-worldcup-client-ts';
import * as fs from 'fs';

const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync('./buyer-keypair.json', 'utf8')));
const buyerKeypair = Keypair.fromSecretKey(secretKey);

const client = new FifaWorldCupClient({
  payerKeypair: buyerKeypair,
  endpointBaseUrl: 'https://fifa.polystrike.io/devnet',
  defaultFacilitatorUrl: 'https://preview.ipay.sh',
  logger: (msg) => console.log(`[agent] ${msg}`), // optional
});

// Default news (server merges curated RSS feeds — no targetUrl needed)
const news = await client.getNews();
console.log(news);

// Or use a specific verified source from GET /api/v1/sources
const bbc = await client.getNews('https://feeds.bbci.co.uk/sport/football/rss.xml');
```

## Tiers

| Tier | Window | Use case |
|------|--------|----------|
| `hourly` | 1 hour | Short-lived bots, testing |
| `daily` | 24 hours | Day-trading agents |
| `monthly` | 30 days | Production agents — traditional monthly SaaS on x402 |

## Discovery endpoints (free)

- `GET /health`
- `GET /api/v1/subscribe/info` — tier list
- `GET /api/v1/sources` — verified scrapeable URLs

## Running tests

```bash
npm install
# Fund buyer-keypair.json with devnet SOL + USDC
npm test
```

## Forking for your own seller

Copy this client and change `endpointBaseUrl`. The pr402 payment flow (`pr402-exact-flow.ts`) is aligned with [x402-buyer-starter](https://github.com/miralandlabs/x402-buyer-starter).
