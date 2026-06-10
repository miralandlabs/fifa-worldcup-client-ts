import { Keypair } from '@solana/web3.js';
import axios, { type AxiosResponse } from 'axios';
import { buildExactPaymentProofJsonString, type PaymentRequiredBody } from './pr402-exact-flow.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Tier = 'hourly' | 'daily' | 'monthly';

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

export class FifaApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'FifaApiError';
    this.status = status;
    this.code = code;
  }
}

const HTTP_TIMEOUT_MS = 15_000;

// ── Client ───────────────────────────────────────────────────────────────────

export class FifaWorldCupClient {
  private payer: Keypair;
  private endpointBaseUrl: string;
  private defaultFacilitatorUrl: string;
  private logger?: (message: string) => void;

  private activeSubscription: SubscriptionInfo | null = null;

  constructor(options: {
    payerKeypair: Keypair;
    endpointBaseUrl: string;
    defaultFacilitatorUrl?: string;
    logger?: (message: string) => void;
  }) {
    this.payer = options.payerKeypair;
    this.endpointBaseUrl = options.endpointBaseUrl.replace(/\/$/, '');
    this.defaultFacilitatorUrl = options.defaultFacilitatorUrl || 'https://preview.ipay.sh';
    this.logger = options.logger;
  }

  private log(message: string): void {
    this.logger?.(message);
  }

  public async subscribe(tier: Tier = 'hourly'): Promise<SubscriptionInfo> {
    const url = `${this.endpointBaseUrl}/api/v1/subscribe?tier=${tier}`;

    const probeRes = await axios.post(url, {}, {
      timeout: HTTP_TIMEOUT_MS,
      validateStatus: () => true,
    });

    if (probeRes.status === 200) {
      return this.storeSubscription(probeRes.data as SubscribeResponse);
    }

    if (probeRes.status !== 402) {
      throw this.apiErrorFromResponse(probeRes);
    }

    const requirements = probeRes.data as PaymentRequiredResponse;
    const paymentSignatureHeader = await buildExactPaymentProofJsonString({
      payer: this.payer,
      requirements: requirements as unknown as PaymentRequiredBody,
      defaultFacilitatorBaseUrl: this.defaultFacilitatorUrl,
      timeoutMs: HTTP_TIMEOUT_MS,
    });

    const subscribeRes = await axios.post<SubscribeResponse>(url, {}, {
      timeout: HTTP_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'PAYMENT-SIGNATURE': paymentSignatureHeader,
      },
      validateStatus: () => true,
    });

    if (subscribeRes.status !== 200) {
      throw this.apiErrorFromResponse(subscribeRes);
    }

    return this.storeSubscription(subscribeRes.data);
  }

  public getActiveSubscription(): SubscriptionInfo | null {
    if (!this.activeSubscription) return null;
    if (this.activeSubscription.expiresAt <= new Date()) {
      this.activeSubscription = null;
      return null;
    }
    return this.activeSubscription;
  }

  public async getOdds(targetUrl?: string, tier: Tier = 'hourly'): Promise<OddsItem[]> {
    const body = targetUrl ? { targetUrl } : {};
    const res = await this.requestWithToken<{ data: OddsItem[] }>('/api/v1/odds', body, tier);
    return res.data;
  }

  public async getNews(targetUrl?: string, tier: Tier = 'hourly'): Promise<NewsItem[]> {
    const body = targetUrl ? { targetUrl } : {};
    const res = await this.requestWithToken<{ data: NewsItem[] }>('/api/v1/news', body, tier);
    return res.data;
  }

  public async getTickets(targetUrl: string, tier: Tier = 'hourly'): Promise<TicketItem[]> {
    const res = await this.requestWithToken<{ data: TicketItem[] }>(
      '/api/v1/tickets',
      { targetUrl },
      tier,
    );
    return res.data;
  }

  private async requestWithToken<T>(
    path: string,
    body: Record<string, unknown>,
    tier: Tier,
  ): Promise<T> {
    if (!this.getActiveSubscription()) {
      await this.subscribe(tier);
    }

    const url = `${this.endpointBaseUrl}${path}`;
    const bearerToken = this.activeSubscription!.token;

    const res = await axios.post<T>(url, body, {
      timeout: HTTP_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${bearerToken}`,
      },
      validateStatus: () => true,
    });

    if (res.status === 200) {
      return res.data;
    }

    if (res.status === 401) {
      const errData = res.data as { error?: string };
      if (errData.error === 'TOKEN_EXPIRED' || errData.error === 'TOKEN_REVOKED') {
        this.log(`Token ${errData.error} — renewing subscription...`);
        this.activeSubscription = null;
        await this.subscribe(tier);

        const retryRes = await axios.post<T>(url, body, {
          timeout: HTTP_TIMEOUT_MS,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.activeSubscription!.token}`,
          },
          validateStatus: () => true,
        });

        if (retryRes.status === 200) {
          return retryRes.data;
        }
        throw this.apiErrorFromResponse(retryRes);
      }
    }

    throw this.apiErrorFromResponse(res);
  }

  private apiErrorFromResponse(res: AxiosResponse): FifaApiError {
    const data = res.data as { error?: string; message?: string } | undefined;
    const code = data?.error;
    const message = data?.message || JSON.stringify(data) || `HTTP ${res.status}`;
    return new FifaApiError(res.status, message, code);
  }

  private storeSubscription(data: SubscribeResponse): SubscriptionInfo {
    const info: SubscriptionInfo = {
      tier: data.tier,
      token: data.token,
      expiresAt: new Date(data.expiresAt),
    };
    this.activeSubscription = info;
    this.log(
      `Subscription active — tier: ${data.tier} (${data.tierLabel}), expires: ${data.expiresAt}`,
    );
    return info;
  }
}
