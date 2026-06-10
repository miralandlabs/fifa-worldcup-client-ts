# FIFA World Cup 2026 Scraper - Client SDK Template

An open-source integration client demonstrating how to fetch in-play odds, ticket arbitrage metrics, and team news from the `fifa-worldcup-scraper` API using automated `x402` micropayments.

## Installation

```bash
npm install fifa-worldcup-client-ts
```

## Quick Start

```typescript
import { Keypair } from '@solana/web3.js';
import { FifaWorldCupClient } from 'fifa-worldcup-client-ts';
import * as fs from 'fs';

// 1. Load your local Solana payer keypair (used to fund transaction proofs)
const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync('./buyer-keypair.json', 'utf8')));
const buyerKeypair = Keypair.fromSecretKey(secretKey);

// 2. Initialize the client targeting the scraper node
const client = new FifaWorldCupClient({
  payerKeypair: buyerKeypair,
  endpointBaseUrl: 'https://fifa.polystrike.io/devnet', // Scraper endpoint
  defaultFacilitatorUrl: 'https://preview.ipay.sh' // Facilitator node
});

// 3. Make paid request (automatically catches 402, requests block building, signs, and fetches data)
const odds = await client.getOdds('https://www.pinnacle.com/en/soccer/fifa-world-cup/matchups');
console.log(odds);
```

## Running the Demo

To run the local demonstration script:
1. Ensure you have a valid Solana keypair file named `buyer-keypair.json` in the project root:
   ```bash
   solana-keygen new -o ./buyer-keypair.json --no-bip39-passphrase
   ```
2. Fund the wallet with some devnet SOL (for rent/fees):
   ```bash
   solana airdrop 1 $(solana-keygen pubkey ./buyer-keypair.json) --url devnet
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Run the demo:
   ```bash
   npm run demo
   ```
