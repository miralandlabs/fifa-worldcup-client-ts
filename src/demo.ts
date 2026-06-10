import 'dotenv/config';
import { Keypair } from '@solana/web3.js';
import { FifaWorldCupClient } from './client.js';
import * as fs from 'fs';

async function run() {
  console.log('🚀 FIFA World Cup 2026 Data API — Subscription Demo');
  console.log('='.repeat(55));
  console.log('Business model: pay once → get a time-window token → unlimited data calls');
  console.log('');

  // ── 1. Resolve buyer keypair ──────────────────────────────────────────────

  const keypairPath = process.env.BUYER_KEYPAIR_PATH || './buyer-keypair.json';
  if (!fs.existsSync(keypairPath)) {
    console.error(`❌ Keypair file not found at ${keypairPath}.`);
    console.log('Generate one with:  solana-keygen new -o ./buyer-keypair.json --no-bip39-passphrase');
    process.exit(1);
  }

  const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf8')));
  const buyerKeypair = Keypair.fromSecretKey(secretKey);
  console.log(`✅ Buyer wallet: ${buyerKeypair.publicKey.toBase58()}`);

  // ── 2. Initialize client ──────────────────────────────────────────────────

  const endpointBaseUrl = process.env.API_BASE_URL || 'https://fifa.polystrike.io/devnet';
  const client = new FifaWorldCupClient({
    payerKeypair: buyerKeypair,
    endpointBaseUrl,
    defaultFacilitatorUrl: process.env.FACILITATOR_BASE_URL || 'https://preview.ipay.sh',
  });
  console.log(`✅ API endpoint: ${endpointBaseUrl}`);
  console.log('');

  // ── 3. Explicit subscription (optional — auto-triggered by data methods) ──

  console.log('--- Step 1: Purchase an hourly subscription (one x402 payment) ---');
  try {
    const sub = await client.subscribe('hourly');
    console.log(`✅ Subscribed! Token valid until: ${sub.expiresAt.toISOString()}`);
    console.log(`   Tier: ${sub.tier}`);
    console.log(`   Token (first 32 chars): ${sub.token.slice(0, 32)}...`);
  } catch (err: any) {
    console.error(`❌ Subscription failed: ${err.message}`);
    process.exit(1);
  }

  console.log('');
  console.log('--- Step 2: Use all data endpoints freely (no additional payments) ---');
  console.log('    (If the token expires mid-session, the client auto-renews it)');
  console.log('');

  // ── 4. Call data endpoints — no x402 payments needed ────────────────────

  try {
    console.log('📊 1/3 — Fetching live betting odds...');
    const odds = await client.getOdds('https://www.pinnacle.com/en/soccer/fifa-world-cup/matchups');
    console.log(`   ✅ Received ${odds.length} odds items.`);
    if (odds.length > 0) console.dir(odds.slice(0, 2), { depth: null });
  } catch (err: any) {
    console.error(`   ❌ Failed: ${err.message}`);
  }

  try {
    console.log('📰 2/3 — Fetching breaking news & sentiment...');
    const news = await client.getNews('https://www.fifa.com/en/news');
    console.log(`   ✅ Received ${news.length} articles.`);
    if (news.length > 0) console.dir(news.slice(0, 2), { depth: null });
  } catch (err: any) {
    console.error(`   ❌ Failed: ${err.message}`);
  }

  try {
    console.log('🎟️  3/3 — Fetching ticket resale prices...');
    const tickets = await client.getTickets('https://www.stubhub.com/fifa-world-cup-tickets');
    console.log(`   ✅ Received ${tickets.length} listings.`);
    if (tickets.length > 0) console.dir(tickets.slice(0, 2), { depth: null });
  } catch (err: any) {
    console.error(`   ❌ Failed: ${err.message}`);
  }

  console.log('');
  console.log('='.repeat(55));
  console.log('✅ Demo complete. Only ONE x402 payment was made for all 3 queries.');

  // Show remaining subscription time
  const active = client.getActiveSubscription();
  if (active) {
    const remainMs = active.expiresAt.getTime() - Date.now();
    const remainMin = Math.round(remainMs / 60_000);
    console.log(`   Subscription still valid for ~${remainMin} more minutes.`);
  }
}

run().catch(console.error);
