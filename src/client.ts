import { Keypair, VersionedTransaction } from '@solana/web3.js';
import axios from 'axios';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Tier = 'hourly' | 'daily';

export interface OddsItem {
  matchName: string;
  homeOdds: string;
  awayOdds: string;
  drawOdds?: string;
  bookmaker: string;
}

export interface NewsItem {
  title: string;
  link: string;
  summary: string;
  source: string;
}

export interface TicketItem {
  venue: string;
  section: string;
  row: string;
  price: string;
  link: string;
}

export interface AcceptsRow {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface PaymentRequiredResponse {
  x402Version: number;
  resource: {
    url: string;
    description: string;
    mimeType: string;
  };
  accepts: AcceptsRow[];
  extensions: { pr402FacilitatorUrl: string };
}

export interface SubscribeResponse {
  success: boolean;
  token: string;
  tier: Tier;
  tierLabel: string;
  expiresAt: string;
  durationSeconds: number;
  usage: string;
}

export interface SubscriptionInfo {
  tier: Tier;
  token: string;
  expiresAt: Date;
}

// ── Client ───────────────────────────────────────────────────────────────────

export class FifaWorldCupClient {
  private payer: Keypair;
  private endpointBaseUrl: string;
  private defaultFacilitatorUrl: string;

  // In-memory subscription state — auto-renewed transparently
  private activeSubscription: SubscriptionInfo | null = null;

  constructor(options: {
    payerKeypair: Keypair;
    endpointBaseUrl: string;        // e.g. https://fifa.polystrike.io/devnet
    defaultFacilitatorUrl?: string; // e.g. https://preview.ipay.sh
  }) {
    this.payer = options.payerKeypair;
    this.endpointBaseUrl = options.endpointBaseUrl.replace(/\/$/, '');
    this.defaultFacilitatorUrl = options.defaultFacilitatorUrl || 'https://preview.ipay.sh';
  }

  // ── Public: Subscription management ────────────────────────────────────────

  /**
   * Purchase a time-window subscription via x402.
   * Called automatically by data methods when no valid token is held.
   * You can also call this manually to pre-warm the subscription.
   *
   * @param tier  'hourly' (default) or 'daily'
   */
  public async subscribe(tier: Tier = 'hourly'): Promise<SubscriptionInfo> {
    const url = `${this.endpointBaseUrl}/api/v1/subscribe?tier=${tier}`;

    // Step 1: Probe the subscription endpoint — get x402 payment requirements
    const probeRes = await axios.post(url, {}, {
      validateStatus: (s) => s === 200 || s === 402,
    });

    if (probeRes.status === 200) {
      // Token already accepted (edge case: server pre-auth), shouldn't normally happen
      const data = probeRes.data as SubscribeResponse;
      return this.storeSubscription(data);
    }

    if (probeRes.status !== 402) {
      throw new Error(`Unexpected subscribe probe status: ${probeRes.status}`);
    }

    const requirements = probeRes.data as PaymentRequiredResponse;

    // Step 2: Match payment accept line
    const acceptLine = requirements.accepts.find(
      (a) => a.scheme === 'exact' || a.scheme === 'v2:solana:exact',
    );
    if (!acceptLine) {
      throw new Error('No supported x402 exact payment rail found in subscribe response.');
    }

    const canonicalAcceptLine = {
      ...acceptLine,
      scheme: acceptLine.scheme === 'v2:solana:exact' ? 'exact' : acceptLine.scheme,
    };

    const facilitatorBase =
      requirements.extensions?.pr402FacilitatorUrl || this.defaultFacilitatorUrl;

    // Step 3: Build the payment transaction via pr402 facilitator
    const txBuildRes = await axios.post(
      `${facilitatorBase}/api/v1/facilitator/build-exact-payment-tx`,
      {
        payer: this.payer.publicKey.toBase58(),
        accepted: canonicalAcceptLine,
        resource: requirements.resource,
      },
    );

    const buildData = txBuildRes.data as {
      transaction: string;
      verifyBodyTemplate: {
        paymentPayload: { payload: { transaction: string } };
      };
    };

    // Step 4: Sign the transaction locally (private key never leaves this process)
    const txBytes = Buffer.from(buildData.transaction, 'base64');
    const vtx = VersionedTransaction.deserialize(txBytes);
    vtx.sign([this.payer]);

    const signedTxBase64 = Buffer.from(vtx.serialize()).toString('base64');
    const verifyBody = buildData.verifyBodyTemplate;
    verifyBody.paymentPayload.payload.transaction = signedTxBase64;

    const paymentSignatureHeader = JSON.stringify(verifyBody);

    // Step 5: Submit payment and receive subscription JWT
    const subscribeRes = await axios.post<SubscribeResponse>(url, {}, {
      headers: {
        'Content-Type': 'application/json',
        'PAYMENT-SIGNATURE': paymentSignatureHeader,
      },
    });

    return this.storeSubscription(subscribeRes.data);
  }

  /**
   * Return current subscription info (without triggering renewal).
   * Returns null if no active subscription exists or it has expired.
   */
  public getActiveSubscription(): SubscriptionInfo | null {
    if (!this.activeSubscription) return null;
    if (this.activeSubscription.expiresAt <= new Date()) {
      this.activeSubscription = null;
      return null;
    }
    return this.activeSubscription;
  }

  // ── Public: Data endpoints ──────────────────────────────────────────────────

  /**
   * Fetch live betting odds. Auto-subscribes (hourly) if no valid token held.
   */
  public async getOdds(targetUrl: string, tier: Tier = 'hourly'): Promise<OddsItem[]> {
    const res = await this.requestWithToken<{ data: OddsItem[] }>(
      '/api/v1/odds',
      { targetUrl },
      tier,
    );
    return res.data;
  }

  /**
   * Fetch breaking sports news. Auto-subscribes (hourly) if no valid token held.
   */
  public async getNews(targetUrl: string, tier: Tier = 'hourly'): Promise<NewsItem[]> {
    const res = await this.requestWithToken<{ data: NewsItem[] }>(
      '/api/v1/news',
      { targetUrl },
      tier,
    );
    return res.data;
  }

  /**
   * Fetch ticket resale prices. Auto-subscribes (hourly) if no valid token held.
   */
  public async getTickets(targetUrl: string, tier: Tier = 'hourly'): Promise<TicketItem[]> {
    const res = await this.requestWithToken<{ data: TicketItem[] }>(
      '/api/v1/tickets',
      { targetUrl },
      tier,
    );
    return res.data;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Ensure a valid subscription token exists, then make the authenticated request.
   * On 401 TOKEN_EXPIRED, auto-renews and retries once.
   */
  private async requestWithToken<T>(
    path: string,
    body: Record<string, unknown>,
    tier: Tier,
  ): Promise<T> {
    // Auto-subscribe if no valid token
    if (!this.getActiveSubscription()) {
      await this.subscribe(tier);
    }

    const url = `${this.endpointBaseUrl}${path}`;
    const bearerToken = this.activeSubscription!.token;

    const res = await axios.post<T>(url, body, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bearerToken}`,
      },
      validateStatus: (s) => s === 200 || s === 401,
    });

    if (res.status === 200) {
      return res.data;
    }

    // 401: token expired or revoked — renew and retry once
    const errData = res.data as { error?: string };
    if (errData.error === 'TOKEN_EXPIRED' || errData.error === 'TOKEN_REVOKED') {
      console.log(`[FifaWorldCupClient] Token ${errData.error} — renewing subscription...`);
      this.activeSubscription = null;
      await this.subscribe(tier);

      // Retry with fresh token
      const retryRes = await axios.post<T>(url, body, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.activeSubscription!.token}`,
        },
      });
      return retryRes.data;
    }

    throw new Error(`Request failed (${res.status}): ${JSON.stringify(res.data)}`);
  }

  private storeSubscription(data: SubscribeResponse): SubscriptionInfo {
    const info: SubscriptionInfo = {
      tier: data.tier,
      token: data.token,
      expiresAt: new Date(data.expiresAt),
    };
    this.activeSubscription = info;
    console.log(
      `[FifaWorldCupClient] Subscription active — tier: ${data.tier} (${data.tierLabel}), expires: ${data.expiresAt}`,
    );
    return info;
  }
}
