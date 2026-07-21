import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  encodeFunctionData,
  keccak256,
  encodePacked,
  parseUnits,
  type Address,
} from 'viem';
import { v4 as uuidv4 } from 'uuid';
import { BlockchainService } from '../blockchain/blockchain.service';
import { RatesService } from '../rates/rates.service';
import { AgentChatDto } from './dto/agent.dto';
import {
  NETWORK_CODES,
  resolveToken,
  type PaymentToken,
} from '../blockchain/payment-tokens';

/** A transaction the agent has prepared for the user to sign in their wallet. */
export interface PreparedTx {
  id: string;
  kind: 'airtime' | 'batch-transfer';
  summary: string;
  chainId: number;
  to: Address;
  data: `0x${string}`;
  value: string; // native value in wei (string for JSON safety)
  token: { symbol: string; address: Address; decimals: number; isNative: boolean };
  amount: string; // token amount in base units (for ERC-20 approval)
  requiresApproval: boolean;
  /** Frontend calls this after the tx confirms on-chain (e.g. airtime fulfilment). */
  postAction?: {
    type: 'registerAirtimeOrder';
    payload: {
      chainId: number;
      networkCode: string;
      phoneNumber: string;
      amountNgn: number;
    };
  };
}

/** A recurring schedule the agent has prepared for the user to confirm & save. */
export interface PreparedSchedule {
  id: string;
  summary: string;
  /** Body the frontend POSTs to the JWT-guarded `POST /api/schedules` endpoint. */
  payload: {
    kind: 'airtime' | 'batch-transfer';
    chainId: number;
    tokenSymbol: string;
    cadence: 'daily' | 'weekly' | 'monthly';
    label?: string;
    spendCapUsd?: number;
    startAt?: string;
    endAt?: string;
    phoneNumber?: string;
    amountNgn?: number;
    network?: string;
    recipients?: { address: string; amount: string }[];
  };
}

/**
 * A client-side directive the agent asks the frontend to fulfil. Used for
 * read-only data the agent can't see server-side (the /agent endpoint is
 * unauthenticated) — the frontend runs these with the signed-in user's JWT and
 * renders the results as chat cards.
 */
export type AgentAction =
  | { type: 'list_schedules' }
  | { type: 'list_due' }
  | { type: 'recent_activity'; limit: number }
  | { type: 'navigate'; href: string; label: string };

export interface AgentChatResult {
  reply: string;
  transactions: PreparedTx[];
  schedules: PreparedSchedule[];
  actions: AgentAction[];
}

/** Slots gathered from the conversation for a payment/schedule. */
interface Slots {
  phone: string | null;
  amountNgn: number | null;
  network: string | null; // MTN | GLO | AIRTEL | 9MOBILE
  tokenSymbol: string | null;
  cadence: 'daily' | 'weekly' | 'monthly' | null;
  recipients: { address: string; amount: string }[];
  confirmed: boolean;
}

const NETWORKS = ['MTN', 'GLO', 'AIRTEL', '9MOBILE'];

/**
 * The GigiPay Agent — a local, rule-based conversational engine (no external LLM
 * / no API cost). It understands natural-language requests for Gigipay's
 * services and either prepares a signable transaction/schedule or asks the
 * frontend to fetch the user's data.
 *
 * Supported intents: buy airtime, batch/payroll transfer, price quote, create a
 * recurring schedule, list schedules, show due payments, recent activity, plus
 * help / greeting / capabilities.
 */
@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly maxSpendUsd: number;

  constructor(
    private readonly config: ConfigService,
    private readonly blockchain: BlockchainService,
    private readonly rates: RatesService,
  ) {
    this.maxSpendUsd = this.config.get<number>('agent.maxSpendUsd') ?? 50;
  }

  async chat(dto: AgentChatDto): Promise<AgentChatResult> {
    const chainId =
      dto.chainId ?? this.config.get<number>('agent.defaultChainId') ?? 42220;

    const userMessages = dto.messages.filter((m) => m.role === 'user');
    const last = userMessages[userMessages.length - 1]?.content ?? '';
    // Merge the last few user turns so multi-turn slot-filling works
    // ("buy airtime" → "08012345678" → "MTN 500 USDC").
    const context = userMessages
      .slice(-6)
      .map((m) => m.content)
      .join('\n');

    const text = last.toLowerCase().trim();
    const empty: AgentChatResult = {
      reply: '',
      transactions: [],
      schedules: [],
      actions: [],
    };

    try {
      // ── Small talk ──────────────────────────────────────────────────────
      if (this.isGreeting(text)) {
        return { ...empty, reply: this.greeting() };
      }
      if (/\b(thanks|thank you|thankz|cheers|appreciate)\b/.test(text)) {
        return {
          ...empty,
          reply: "You're welcome! Anything else I can help you pay? 💚",
        };
      }
      if (this.isHelp(text)) {
        return { ...empty, reply: this.capabilities() };
      }

      // ── Data reads (fulfilled on the frontend with the user's JWT) ──────
      if (this.isListSchedules(text)) {
        return {
          ...empty,
          reply: 'Here are your recurring payments:',
          actions: [{ type: 'list_schedules' }],
        };
      }
      if (this.isDue(text)) {
        return {
          ...empty,
          reply: 'Here’s what’s due to pay right now:',
          actions: [{ type: 'list_due' }],
        };
      }
      if (this.isRecent(text)) {
        const limit = this.extractCount(text) ?? 5;
        return {
          ...empty,
          reply: `Here are your last ${limit} payment(s):`,
          actions: [{ type: 'recent_activity', limit }],
        };
      }

      // ── Actions ─────────────────────────────────────────────────────────
      const slots = this.extractSlots(context);
      const recurring = this.isRecurring(text) || this.isRecurring(context);

      if (recurring && (this.isAirtime(context) || slots.phone)) {
        return this.handleScheduleAirtime(chainId, slots);
      }
      if (recurring && (this.isBatch(context) || slots.recipients.length)) {
        return this.handleScheduleBatch(chainId, slots);
      }

      if (this.isQuote(text) && !this.isAirtime(text)) {
        return this.handleQuote(chainId, slots);
      }

      if (this.isAirtime(text) || this.isAirtime(context)) {
        return await this.handleAirtime(chainId, slots);
      }

      if (this.isBatch(text) || slots.recipients.length > 0) {
        return this.handleBatch(chainId, slots);
      }

      if (this.isQuote(text)) {
        return this.handleQuote(chainId, slots);
      }

      // ── Fallback ────────────────────────────────────────────────────────
      return {
        ...empty,
        reply:
          "I’m not sure I caught that. " + this.capabilities(),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      return { ...empty, reply: msg };
    }
  }

  // ─── Intent detection ────────────────────────────────────────────────────

  private isGreeting(t: string): boolean {
    return /^(hi|hii+|hey+|hello|yo|sup|good\s?(morning|afternoon|evening)|gm|how far|hola)\b[!. ]*$/.test(
      t,
    );
  }

  private isHelp(t: string): boolean {
    return /\b(help|what can you do|what do you do|menu|options|commands|guide|how does this work|who are you|what are you)\b/.test(
      t,
    );
  }

  private isListSchedules(t: string): boolean {
    return (
      /\bschedul/.test(t) &&
      /\b(my|show|list|view|see|any|active|current|check)\b/.test(t) &&
      !this.isRecurring(t) // "set up a schedule" is creation, not listing
    );
  }

  private isDue(t: string): boolean {
    return /\b(due|pay now|pending|to pay|owe|outstanding|what.*(do i|to) pay)\b/.test(
      t,
    );
  }

  private isRecent(t: string): boolean {
    return /\b(recent|history|last\s+\d+|previous|past|activity|transactions?|what.*(paid|sent))\b/.test(
      t,
    );
  }

  private isRecurring(t: string): boolean {
    return /\b(every|each|recurring|repeat|automatic|auto\s?pay|autopay|weekly|monthly|daily|schedule|every\s?(day|week|month|friday|monday|tuesday|wednesday|thursday|saturday|sunday))\b/.test(
      t,
    );
  }

  private isAirtime(t: string): boolean {
    return /\b(airtime|top.?up|recharge|credit|data\b|minutes|call card)\b/.test(t);
  }

  private isBatch(t: string): boolean {
    return (
      /\b(batch|payroll|salary|salaries|split|send to|pay (my )?team|multiple|many recipients|bulk)\b/.test(
        t,
      ) || /0x[a-fA-F0-9]{40}/.test(t)
    );
  }

  private isQuote(t: string): boolean {
    return /\b(quote|how much|convert|price|rate|worth|cost|equal|in usd|in usdc|in usdt)\b/.test(
      t,
    );
  }

  // ─── Intent handlers ─────────────────────────────────────────────────────

  private greeting(): string {
    return "Hi 👋 I’m the GigiPay assistant. I can buy airtime, run payroll/batch payments, set up recurring payments, and show your schedules, due payments and recent activity — all paid with stablecoins, and you sign every payment yourself.\n\nWhat would you like to do?";
  }

  private capabilities(): string {
    return [
      'Here’s what I can help with:',
      '• 📱 Buy airtime — e.g. “Send ₦500 MTN airtime to 08012345678 with USDC”',
      '• 👥 Payroll / batch — e.g. “Pay 5 USDC each to 0xabc… and 0xdef…”',
      '• 🔁 Recurring payments — e.g. “Every Friday send ₦1000 MTN airtime to 08012345678”',
      '• 💱 Price quote — e.g. “How much is ₦2000 in USDT?”',
      '• 🗓️ Your schedules — “show my schedules”',
      '• ⏰ Due payments — “what’s due to pay?”',
      '• 🧾 Recent activity — “show my last 5 payments”',
      '',
      'Just tell me what you need in plain language.',
    ].join('\n');
  }

  private async handleAirtime(
    chainId: number,
    slots: Slots,
  ): Promise<AgentChatResult> {
    const base: AgentChatResult = {
      reply: '',
      transactions: [],
      schedules: [],
      actions: [],
    };
    const missing: string[] = [];
    if (!slots.phone) missing.push('the phone number (e.g. 08012345678)');
    if (!slots.amountNgn) missing.push('the amount in Naira (e.g. ₦500)');
    if (!slots.network)
      missing.push('the network (MTN, GLO, AIRTEL or 9MOBILE)');

    if (missing.length) {
      return {
        ...base,
        reply:
          'Sure — I can top that up. I just need ' +
          this.joinList(missing) +
          '.',
      };
    }

    const tokenSymbol = slots.tokenSymbol ?? 'USDC';
    // Soft spend guard.
    const usd = await this.ngnToUsd(slots.amountNgn!);
    if (usd > this.maxSpendUsd && !slots.confirmed) {
      return {
        ...base,
        reply: `That’s about $${usd.toFixed(
          2,
        )} — above the $${this.maxSpendUsd} safety cap for a single payment. Reply “confirm” to go ahead, or use a smaller amount.`,
      };
    }

    const tx = await this.buildAirtime(
      chainId,
      slots.phone!,
      slots.amountNgn!,
      slots.network!,
      tokenSymbol,
    );
    return {
      ...base,
      reply: `Here’s your ${tx.summary}. Review and sign it below — you pay the network fee and I never touch your funds.`,
      transactions: [tx],
    };
  }

  private handleBatch(chainId: number, slots: Slots): AgentChatResult {
    const base: AgentChatResult = {
      reply: '',
      transactions: [],
      schedules: [],
      actions: [],
    };
    if (slots.recipients.length === 0) {
      return {
        ...base,
        reply:
          'To run a batch/payroll payment, give me each recipient and amount. For example:\n0xabc…, 5\n0xdef…, 10\nor “Pay 5 USDC each to 0xabc… and 0xdef…”.',
      };
    }
    const tokenSymbol = slots.tokenSymbol ?? 'USDC';
    const tx = this.buildBatch(chainId, slots.recipients, tokenSymbol);
    return {
      ...base,
      reply: `Ready: ${tx.summary} for a total of ${this.totalHuman(
        slots.recipients,
      )} ${tokenSymbol}. Review and sign below.`,
      transactions: [tx],
    };
  }

  private async handleQuote(
    chainId: number,
    slots: Slots,
  ): Promise<AgentChatResult> {
    const base: AgentChatResult = {
      reply: '',
      transactions: [],
      schedules: [],
      actions: [],
    };
    if (!slots.amountNgn) {
      return {
        ...base,
        reply:
          'Tell me the amount and token — e.g. “How much is ₦2000 in USDT?”.',
      };
    }
    const token = resolveToken(chainId, slots.tokenSymbol ?? 'USDC');
    const human = await this.quoteHuman(chainId, slots.amountNgn, token);
    return {
      ...base,
      reply: `₦${slots.amountNgn.toLocaleString()} ≈ ${human} ${token.symbol} right now.`,
    };
  }

  private handleScheduleAirtime(chainId: number, slots: Slots): AgentChatResult {
    const base: AgentChatResult = {
      reply: '',
      transactions: [],
      schedules: [],
      actions: [],
    };
    const missing: string[] = [];
    if (!slots.phone) missing.push('the phone number');
    if (!slots.amountNgn) missing.push('the amount in Naira');
    if (!slots.network) missing.push('the network');
    if (!slots.cadence)
      missing.push('how often (daily, weekly or monthly)');
    if (missing.length) {
      return {
        ...base,
        reply:
          'Let’s set up that recurring top-up. I still need ' +
          this.joinList(missing) +
          '.',
      };
    }
    const tokenSymbol = slots.tokenSymbol ?? 'USDC';
    const schedule: PreparedSchedule = {
      id: uuidv4(),
      summary: `${slots.cadence}: ₦${slots.amountNgn} ${slots.network} airtime to ${slots.phone}, paid in ${tokenSymbol}`,
      payload: {
        kind: 'airtime',
        chainId,
        tokenSymbol: resolveToken(chainId, tokenSymbol).symbol,
        cadence: slots.cadence!,
        phoneNumber: slots.phone!,
        amountNgn: slots.amountNgn!,
        network: slots.network!,
      },
    };
    return {
      ...base,
      reply: `Here’s your recurring top-up — confirm below to save it. You’ll approve and sign each payment when it’s due.`,
      schedules: [schedule],
    };
  }

  private handleScheduleBatch(chainId: number, slots: Slots): AgentChatResult {
    const base: AgentChatResult = {
      reply: '',
      transactions: [],
      schedules: [],
      actions: [],
    };
    const missing: string[] = [];
    if (slots.recipients.length === 0)
      missing.push('the recipients and amounts');
    if (!slots.cadence) missing.push('how often (daily, weekly or monthly)');
    if (missing.length) {
      return {
        ...base,
        reply: 'Let’s set up recurring payroll. I still need ' +
          this.joinList(missing) +
          '.',
      };
    }
    const tokenSymbol = slots.tokenSymbol ?? 'USDC';
    // Validate recipient addresses up front.
    for (const r of slots.recipients) {
      if (!/^0x[a-fA-F0-9]{40}$/.test(r.address))
        throw new Error(`That address doesn’t look right: ${r.address}`);
    }
    const schedule: PreparedSchedule = {
      id: uuidv4(),
      summary: `${slots.cadence}: pay ${tokenSymbol} to ${slots.recipients.length} recipient(s)`,
      payload: {
        kind: 'batch-transfer',
        chainId,
        tokenSymbol: resolveToken(chainId, tokenSymbol).symbol,
        cadence: slots.cadence!,
        recipients: slots.recipients,
      },
    };
    return {
      ...base,
      reply:
        'Here’s your recurring payroll — confirm below to save it. You sign each run when it’s due.',
      schedules: [schedule],
    };
  }

  // ─── Builders (reused calldata builders) ─────────────────────────────────

  private async buildAirtime(
    chainId: number,
    phoneNumber: string,
    amountNgn: number,
    network: string,
    tokenSymbol: string,
  ): Promise<PreparedTx> {
    const token = resolveToken(chainId, tokenSymbol);
    if (!/^0[7-9][01]\d{8}$/.test(phoneNumber))
      throw new Error(
        'That phone number doesn’t look right — Nigerian numbers are 11 digits, e.g. 08012345678.',
      );
    if (!(amountNgn >= 50 && amountNgn <= 200000))
      throw new Error('Airtime must be between ₦50 and ₦200,000.');
    const networkCode = NETWORK_CODES[network];
    if (!networkCode)
      throw new Error('Network must be MTN, GLO, AIRTEL or 9MOBILE.');

    const human = await this.quoteHuman(chainId, amountNgn, token);
    const amountBase = parseUnits(human, token.decimals);
    const recipientHash = keccak256(encodePacked(['string'], [phoneNumber]));

    const built = this.blockchain.buildPayBillTx(
      chainId,
      token.address,
      amountBase,
      'airtime',
      networkCode,
      recipientHash,
    );

    return {
      id: uuidv4(),
      kind: 'airtime',
      summary: `₦${amountNgn} ${network} airtime to ${phoneNumber} — pay ${human} ${token.symbol}`,
      chainId,
      to: built.to,
      data: encodeFunctionData({
        abi: built.abi,
        functionName: built.functionName,
        args: built.args,
      }),
      value: (built.value ?? 0n).toString(),
      token: {
        symbol: token.symbol,
        address: token.address,
        decimals: token.decimals,
        isNative: token.isNative,
      },
      amount: amountBase.toString(),
      requiresApproval: !token.isNative,
      postAction: {
        type: 'registerAirtimeOrder',
        payload: { chainId, networkCode, phoneNumber, amountNgn },
      },
    };
  }

  private buildBatch(
    chainId: number,
    recipientsRaw: { address: string; amount: string }[],
    tokenSymbol: string,
  ): PreparedTx {
    const token = resolveToken(chainId, tokenSymbol);
    if (recipientsRaw.length > 200)
      throw new Error('A batch is limited to 200 recipients per transaction.');

    const recipients: Address[] = [];
    const amounts: bigint[] = [];
    for (const r of recipientsRaw) {
      if (!/^0x[a-fA-F0-9]{40}$/.test(r.address))
        throw new Error(`That address doesn’t look right: ${r.address}`);
      if (!(Number(r.amount) > 0))
        throw new Error(`I couldn’t read the amount for ${r.address}.`);
      recipients.push(r.address as Address);
      amounts.push(parseUnits(String(r.amount), token.decimals));
    }
    const total = amounts.reduce((a, b) => a + b, 0n);

    const built = this.blockchain.buildBatchTransferTx(
      chainId,
      token.address,
      recipients,
      amounts,
    );

    return {
      id: uuidv4(),
      kind: 'batch-transfer',
      summary: `Send ${token.symbol} to ${recipients.length} recipient(s)`,
      chainId,
      to: built.to,
      data: encodeFunctionData({
        abi: built.abi,
        functionName: built.functionName,
        args: built.args,
      }),
      value: (built.value ?? 0n).toString(),
      token: {
        symbol: token.symbol,
        address: token.address,
        decimals: token.decimals,
        isNative: token.isNative,
      },
      amount: total.toString(),
      requiresApproval: !token.isNative,
    };
  }

  // ─── Rates helpers ───────────────────────────────────────────────────────

  private async quoteHuman(
    chainId: number,
    amountNgn: number,
    token: PaymentToken,
  ): Promise<string> {
    if (token.isStable) {
      const ngnPerUsd = await this.ngnPerUsd();
      return (amountNgn / ngnPerUsd).toFixed(6);
    }
    const { tokenAmount } = await this.rates.convertNgnToToken(
      chainId,
      amountNgn,
    );
    return tokenAmount;
  }

  private async ngnPerUsd(): Promise<number> {
    const rates = await this.rates.getAllRates();
    const anyRate = Object.values(rates)[0] as
      | { ngn: number; usd: number }
      | undefined;
    if (!anyRate || !anyRate.usd)
      throw new Error('I can’t fetch live rates right now — please try again shortly.');
    return anyRate.ngn / anyRate.usd;
  }

  private async ngnToUsd(amountNgn: number): Promise<number> {
    return amountNgn / (await this.ngnPerUsd());
  }

  // ─── Natural-language slot extraction ────────────────────────────────────

  private extractSlots(context: string): Slots {
    const t = context;
    return {
      phone: this.extractPhone(t),
      amountNgn: this.extractNgn(t),
      network: this.extractNetwork(t),
      tokenSymbol: this.extractToken(t),
      cadence: this.extractCadence(t),
      recipients: this.extractRecipients(t),
      confirmed: /\b(confirm|yes|go ahead|do it|proceed|correct)\b/i.test(t),
    };
  }

  private extractPhone(text: string): string | null {
    const m = text.match(/(?:\+?234|0)\s?([789][01]\d{8})\b/);
    return m ? '0' + m[1] : null;
  }

  private extractNgn(text: string): number | null {
    // Normalise "2k"/"1.5k" → number.
    const norm = text.replace(
      /(\d+(?:\.\d+)?)\s*k\b/gi,
      (_, n: string) => String(Math.round(parseFloat(n) * 1000)),
    );
    // Strip phone numbers so they aren't read as amounts.
    const stripped = norm.replace(/(?:\+?234|0)\s?[789][01]\d{8}\b/g, ' ');
    // Prefer a number tied to a currency marker.
    const cur = stripped.match(/(?:₦|\bngn\b|\bnaira\b|\bn)\s*(\d[\d,]{1,8})/i);
    if (cur) return parseInt(cur[1].replace(/,/g, ''), 10);
    const trailing = stripped.match(/(\d[\d,]{1,8})\s*(?:naira|ngn)\b/i);
    if (trailing) return parseInt(trailing[1].replace(/,/g, ''), 10);
    // Fallback: a lone number in an airtime context.
    if (this.isAirtime(text)) {
      const lone = stripped.match(/\b(\d{2,7})\b/);
      if (lone) return parseInt(lone[1], 10);
    }
    return null;
  }

  private extractNetwork(text: string): string | null {
    const t = text.toLowerCase();
    if (/\bmtn\b/.test(t)) return 'MTN';
    if (/\bglo\b/.test(t)) return 'GLO';
    if (/\bairtel\b/.test(t)) return 'AIRTEL';
    if (/\b9\s?mobile\b|\betisalat\b/.test(t)) return '9MOBILE';
    return null;
  }

  private extractToken(text: string): string | null {
    const t = text.toLowerCase();
    if (/\busdc\b/.test(t)) return 'USDC';
    if (/\busdt\b/.test(t)) return 'USDT';
    if (/\busdm\b/.test(t)) return 'USDm';
    if (/\bcelo\b/.test(t)) return 'CELO';
    return null;
  }

  private extractCadence(text: string): 'daily' | 'weekly' | 'monthly' | null {
    const t = text.toLowerCase();
    if (/\b(daily|every\s?day|each\s?day)\b/.test(t)) return 'daily';
    if (
      /\b(weekly|every\s?week|each\s?week|every\s?(mon|tues|wednes|thurs|fri|satur|sun)day|each\s?(mon|tues|wednes|thurs|fri|satur|sun)day)\b/.test(
        t,
      )
    )
      return 'weekly';
    if (/\b(monthly|every\s?month|each\s?month)\b/.test(t)) return 'monthly';
    return null;
  }

  private extractCount(text: string): number | null {
    const m = text.match(/\b(?:last|recent|past)\s+(\d{1,3})\b/);
    if (m) return Math.min(parseInt(m[1], 10), 50);
    const m2 = text.match(/\b(\d{1,3})\s+(?:transactions?|payments?)\b/);
    if (m2) return Math.min(parseInt(m2[1], 10), 50);
    return null;
  }

  private extractRecipients(
    text: string,
  ): { address: string; amount: string }[] {
    const addrRe = /0x[a-fA-F0-9]{40}/g;
    const matches: { addr: string; idx: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = addrRe.exec(text))) matches.push({ addr: m[0], idx: m.index });
    if (matches.length === 0) return [];
    const addresses = matches.map((x) => x.addr);

    // "N TOKEN each/apiece" → same amount to every address (handles the common
    // one-line "pay 5 USDC each to 0x… and 0x…" phrasing).
    const each = text.match(
      /(\d+(?:\.\d+)?)\s*(?:usdc|usdt|usdm|celo)?\s*(?:each|apiece|per\s?person|to each|to all|to everyone)/i,
    );
    if (each) {
      return this.dedupeRecipients(
        addresses.map((a) => ({ address: a, amount: each[1] })),
      );
    }

    // Positional pairing: for each address, take the amount immediately before
    // it ("5 USDC to 0x…") or right after it ("0x…, 5"), scoped to the window
    // between neighbouring addresses so amounts don't bleed across recipients.
    const out: { address: string; amount: string }[] = [];
    for (let i = 0; i < matches.length; i++) {
      const winStart =
        i === 0 ? 0 : matches[i - 1].idx + matches[i - 1].addr.length;
      const winEnd =
        i + 1 < matches.length ? matches[i + 1].idx : text.length;
      const before = text.slice(winStart, matches[i].idx);
      const after = text.slice(matches[i].idx + matches[i].addr.length, winEnd);
      // Prefer the amount right AFTER the address ("0x…, 5") — checking "before"
      // first would let the previous recipient's trailing amount bleed in. Only
      // fall back to "before" ("5 USDC to 0x…") when there's nothing after.
      const na = after.match(/^[\s,:=>()-]*?(\d+(?:\.\d+)?)/);
      const nb = before.match(
        /(\d+(?:\.\d+)?)\s*(?:usdc|usdt|usdm|celo)?\s*(?:to|:|,|=>|->|→)?\s*$/i,
      );
      const amt = (na && na[1]) || (nb && nb[1]);
      if (amt) out.push({ address: matches[i].addr, amount: amt });
    }
    if (out.length === addresses.length) return this.dedupeRecipients(out);

    // Fallback: a single amount stated once for several addresses ("pay 20 USDC
    // to 0x… and 0x…") → apply it to each. Only when exactly one distinct amount
    // appears (once addresses are removed) to avoid mis-pairing.
    const stripped = text.replace(/0x[a-fA-F0-9]{40}/g, ' ');
    const amounts = [...stripped.matchAll(/\b(\d+(?:\.\d+)?)\b/g)].map(
      (x) => x[1],
    );
    const distinct = [...new Set(amounts)];
    if (distinct.length === 1) {
      return this.dedupeRecipients(
        addresses.map((a) => ({ address: a, amount: distinct[0] })),
      );
    }
    return this.dedupeRecipients(out);
  }

  private dedupeRecipients(
    list: { address: string; amount: string }[],
  ): { address: string; amount: string }[] {
    const seen = new Set<string>();
    const out: { address: string; amount: string }[] = [];
    for (const r of list) {
      const key = r.address.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  }

  // ─── Misc helpers ────────────────────────────────────────────────────────

  private totalHuman(recipients: { amount: string }[]): string {
    const sum = recipients.reduce((a, r) => a + (Number(r.amount) || 0), 0);
    return String(Number(sum.toFixed(6)));
  }

  private joinList(items: string[]): string {
    if (items.length === 1) return items[0];
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }
}
