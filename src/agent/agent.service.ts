import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
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

export interface AgentChatResult {
  reply: string;
  transactions: PreparedTx[];
  schedules: PreparedSchedule[];
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private readonly client: Anthropic | null;
  private readonly model: string;
  private readonly maxSpendUsd: number;

  constructor(
    private readonly config: ConfigService,
    private readonly blockchain: BlockchainService,
    private readonly rates: RatesService,
  ) {
    const apiKey = this.config.get<string>('agent.anthropicApiKey');
    this.model = this.config.get<string>('agent.model') ?? 'claude-opus-4-8';
    this.maxSpendUsd = this.config.get<number>('agent.maxSpendUsd') ?? 50;
    if (!apiKey) {
      this.logger.warn(
        'ANTHROPIC_API_KEY not set — the GigiPay Agent is disabled until it is configured.',
      );
      this.client = null;
    } else {
      this.client = new Anthropic({ apiKey });
    }
  }

  private get tools(): Anthropic.Tool[] {
    return [
      {
        name: 'get_quote',
        description:
          'Convert a Naira (NGN) amount into how much of a token the user would pay. Use before preparing any payment so you can tell the user the cost.',
        input_schema: {
          type: 'object',
          properties: {
            amountNgn: { type: 'number', description: 'Amount in Nigerian Naira' },
            tokenSymbol: { type: 'string', description: 'Token to pay with, e.g. USDC, USDT, USDm, CELO' },
          },
          required: ['amountNgn', 'tokenSymbol'],
        },
      },
      {
        name: 'prepare_airtime_payment',
        description:
          'Prepare (do NOT send) an airtime top-up transaction for the user to sign in their wallet. Only call after you have the phone number, amount, network and token, and the user has confirmed.',
        input_schema: {
          type: 'object',
          properties: {
            phoneNumber: { type: 'string', description: 'Nigerian mobile number, 11 digits e.g. 08012345678' },
            amountNgn: { type: 'number', description: 'Airtime value in Naira (min 50, max 200000)' },
            network: { type: 'string', enum: ['MTN', 'GLO', 'AIRTEL', '9MOBILE'], description: 'Mobile network' },
            tokenSymbol: { type: 'string', description: 'Token to pay with, e.g. USDC, USDT, USDm, CELO' },
          },
          required: ['phoneNumber', 'amountNgn', 'network', 'tokenSymbol'],
        },
      },
      {
        name: 'prepare_batch_transfer',
        description:
          'Prepare (do NOT send) a one-to-many transfer / payroll transaction for the user to sign. Recipient amounts are in human token units (e.g. "10.5" USDC).',
        input_schema: {
          type: 'object',
          properties: {
            tokenSymbol: { type: 'string', description: 'Token to send, e.g. USDC, USDT, USDm, CELO' },
            recipients: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  address: { type: 'string', description: '0x wallet address' },
                  amount: { type: 'string', description: 'Amount in human token units' },
                },
                required: ['address', 'amount'],
              },
            },
          },
          required: ['tokenSymbol', 'recipients'],
        },
      },
      {
        name: 'create_schedule',
        description:
          'Prepare (do NOT save) a RECURRING payment schedule for the user to confirm. Use this when the user wants something to repeat, e.g. "every Friday send ₦1000 airtime to Mum" or "pay my team 20 USDC each every month". The user confirms and saves it in the app; each occurrence is signed by them when it is due. Confirm all details first.',
        input_schema: {
          type: 'object',
          properties: {
            kind: {
              type: 'string',
              enum: ['airtime', 'batch-transfer'],
              description: 'airtime = recurring top-up; batch-transfer = recurring payroll',
            },
            cadence: {
              type: 'string',
              enum: ['daily', 'weekly', 'monthly'],
              description: 'How often the payment repeats',
            },
            tokenSymbol: { type: 'string', description: 'Token to pay with, e.g. USDC, USDT, USDm, CELO' },
            label: { type: 'string', description: 'Optional friendly name, e.g. "Airtime for Mum"' },
            spendCapUsd: { type: 'number', description: 'Optional per-run spend cap in USD' },
            startAt: { type: 'string', description: 'Optional ISO datetime for the first run (defaults to now)' },
            endAt: { type: 'string', description: 'Optional ISO datetime to stop repeating' },
            // airtime fields
            phoneNumber: { type: 'string', description: 'For airtime: Nigerian number, 11 digits' },
            amountNgn: { type: 'number', description: 'For airtime: value in Naira (50–200000)' },
            network: { type: 'string', enum: ['MTN', 'GLO', 'AIRTEL', '9MOBILE'], description: 'For airtime: mobile network' },
            // batch fields
            recipients: {
              type: 'array',
              description: 'For batch-transfer: recipients and amounts in human token units',
              items: {
                type: 'object',
                properties: {
                  address: { type: 'string', description: '0x wallet address' },
                  amount: { type: 'string', description: 'Amount in human token units' },
                },
                required: ['address', 'amount'],
              },
            },
          },
          required: ['kind', 'cadence', 'tokenSymbol'],
        },
      },
    ];
  }

  private systemPrompt(chainId: number): string {
    const chainName =
      chainId === 42220
        ? 'Celo'
        : chainId === 8453
          ? 'Base'
          : chainId === 11142220
            ? 'Celo Sepolia testnet'
            : `chain ${chainId}`;
    return [
      'You are the GigiPay Agent — a friendly payments assistant for Gigipay, a stablecoin payments app.',
      `You help people on ${chainName}: top up Nigerian airtime, send batch/payroll transfers, get price quotes, and set up recurring (scheduled) payments.`,
      '',
      'HARD RULES:',
      '- You never hold keys and never move funds. You PREPARE transactions; the user signs them in their own wallet.',
      '- For anything RECURRING ("every week", "every month", "each Friday"), use create_schedule instead of a one-off prepare_* tool. The user confirms the schedule and signs each occurrence when it is due.',
      '- Always confirm the details (recipient, amount, network, token, and how often) with the user in plain language BEFORE calling a prepare_* or create_schedule tool.',
      '- Use get_quote to show the cost before preparing a payment.',
      `- This involves real money. Keep any single prepared payment under about $${this.maxSpendUsd}. If the user wants more, ask them to confirm explicitly and split it up.`,
      '- Ask for any missing detail rather than guessing (phone number, amount, network, token, recipient addresses).',
      '',
      'STYLE (MiniPay copy rules — follow strictly):',
      '- Say "network fee", never "gas". Say "stablecoin" or "digital dollar", never "crypto".',
      '- Prefer names/phone numbers over raw 0x addresses when talking to the user.',
      '- Be concise and warm. Nigerian phone numbers are 11 digits (e.g. 08012345678).',
    ].join('\n');
  }

  async chat(dto: AgentChatDto): Promise<AgentChatResult> {
    if (!this.client) {
      throw new BadRequestException(
        'The GigiPay Agent is not configured (missing ANTHROPIC_API_KEY).',
      );
    }
    const chainId =
      dto.chainId ?? this.config.get<number>('agent.defaultChainId') ?? 42220;

    const messages: Anthropic.MessageParam[] = dto.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const prepared: PreparedTx[] = [];
    const preparedSchedules: PreparedSchedule[] = [];
    const MAX_TURNS = 6;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 2048,
        system: this.systemPrompt(chainId),
        tools: this.tools,
        messages,
      });

      if (response.stop_reason !== 'tool_use') {
        const reply = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        return { reply, transactions: prepared, schedules: preparedSchedules };
      }

      // Echo the assistant turn (including tool_use blocks) back into history.
      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        try {
          const result = await this.runTool(
            block.name,
            block.input as Record<string, unknown>,
            chainId,
            dto.userAddress,
            prepared,
            preparedSchedules,
          );
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(result),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Error: ${msg}`,
            is_error: true,
          });
        }
      }
      messages.push({ role: 'user', content: toolResults });
    }

    return {
      reply:
        "I couldn't finish that in a few steps — could you restate what you'd like to do?",
      transactions: prepared,
      schedules: preparedSchedules,
    };
  }

  // ─── Tool dispatch ─────────────────────────────────────────────────────────

  private async runTool(
    name: string,
    input: Record<string, unknown>,
    chainId: number,
    userAddress: string | undefined,
    prepared: PreparedTx[],
    preparedSchedules: PreparedSchedule[],
  ): Promise<unknown> {
    switch (name) {
      case 'get_quote':
        return this.getQuote(chainId, Number(input.amountNgn), String(input.tokenSymbol));
      case 'prepare_airtime_payment':
        return this.prepareAirtime(chainId, input, prepared);
      case 'prepare_batch_transfer':
        return this.prepareBatch(chainId, input, prepared);
      case 'create_schedule':
        return this.prepareSchedule(chainId, input, preparedSchedules);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  /** Human token amount for a given NGN value, using live rates. */
  private async quoteHuman(
    chainId: number,
    amountNgn: number,
    token: PaymentToken,
  ): Promise<string> {
    if (token.isStable) {
      const rates = await this.rates.getAllRates();
      const anyRate = Object.values(rates)[0] as
        | { ngn: number; usd: number }
        | undefined;
      if (!anyRate || !anyRate.usd) throw new Error('Rate unavailable right now.');
      const ngnPerUsd = anyRate.ngn / anyRate.usd;
      return (amountNgn / ngnPerUsd).toFixed(6);
    }
    const { tokenAmount } = await this.rates.convertNgnToToken(chainId, amountNgn);
    return tokenAmount;
  }

  private async getQuote(chainId: number, amountNgn: number, symbol: string) {
    const token = resolveToken(chainId, symbol);
    const human = await this.quoteHuman(chainId, amountNgn, token);
    return {
      amountNgn,
      tokenSymbol: token.symbol,
      tokenAmount: human,
      note: `₦${amountNgn} ≈ ${human} ${token.symbol}`,
    };
  }

  private async prepareAirtime(
    chainId: number,
    input: Record<string, unknown>,
    prepared: PreparedTx[],
  ): Promise<unknown> {
    const phoneNumber = String(input.phoneNumber).trim();
    const amountNgn = Number(input.amountNgn);
    const network = String(input.network).toUpperCase();
    const token = resolveToken(chainId, String(input.tokenSymbol));

    if (!/^0[7-9][01]\d{8}$/.test(phoneNumber))
      throw new Error('Invalid Nigerian phone number (expected 11 digits like 08012345678).');
    if (!(amountNgn >= 50 && amountNgn <= 200000))
      throw new Error('Airtime amount must be between ₦50 and ₦200,000.');
    const networkCode = NETWORK_CODES[network];
    if (!networkCode) throw new Error('Network must be MTN, GLO, AIRTEL or 9MOBILE.');

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

    const tx: PreparedTx = {
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
    prepared.push(tx);
    return { prepared: true, id: tx.id, summary: tx.summary, requiresApproval: tx.requiresApproval };
  }

  private prepareBatch(
    chainId: number,
    input: Record<string, unknown>,
    prepared: PreparedTx[],
  ): unknown {
    const token = resolveToken(chainId, String(input.tokenSymbol));
    const recipientsRaw = (input.recipients as Array<{ address: string; amount: string }>) ?? [];
    if (!Array.isArray(recipientsRaw) || recipientsRaw.length === 0)
      throw new Error('Provide at least one recipient.');
    if (recipientsRaw.length > 200)
      throw new Error('Batch is limited to 200 recipients per transaction.');

    const recipients: Address[] = [];
    const amounts: bigint[] = [];
    for (const r of recipientsRaw) {
      if (!/^0x[a-fA-F0-9]{40}$/.test(r.address))
        throw new Error(`Invalid address: ${r.address}`);
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

    const tx: PreparedTx = {
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
    prepared.push(tx);
    return { prepared: true, id: tx.id, summary: tx.summary, count: recipients.length, requiresApproval: tx.requiresApproval };
  }

  private prepareSchedule(
    chainId: number,
    input: Record<string, unknown>,
    preparedSchedules: PreparedSchedule[],
  ): unknown {
    const kind = String(input.kind);
    if (kind !== 'airtime' && kind !== 'batch-transfer')
      throw new Error('kind must be "airtime" or "batch-transfer".');
    const cadence = String(input.cadence);
    if (!['daily', 'weekly', 'monthly'].includes(cadence))
      throw new Error('cadence must be daily, weekly or monthly.');
    const token = resolveToken(chainId, String(input.tokenSymbol));

    const payload: PreparedSchedule['payload'] = {
      kind,
      chainId,
      tokenSymbol: token.symbol,
      cadence: cadence as 'daily' | 'weekly' | 'monthly',
    };
    if (input.label) payload.label = String(input.label);
    if (input.spendCapUsd != null) payload.spendCapUsd = Number(input.spendCapUsd);
    if (input.startAt) payload.startAt = String(input.startAt);
    if (input.endAt) payload.endAt = String(input.endAt);

    let summary: string;
    if (kind === 'airtime') {
      const phoneNumber = String(input.phoneNumber ?? '').trim();
      const amountNgn = Number(input.amountNgn);
      const network = String(input.network ?? '').toUpperCase();
      if (!/^0[7-9][01]\d{8}$/.test(phoneNumber))
        throw new Error('Invalid Nigerian phone number (expected 11 digits like 08012345678).');
      if (!(amountNgn >= 50 && amountNgn <= 200000))
        throw new Error('Airtime amount must be between ₦50 and ₦200,000.');
      if (!NETWORK_CODES[network])
        throw new Error('Network must be MTN, GLO, AIRTEL or 9MOBILE.');
      payload.phoneNumber = phoneNumber;
      payload.amountNgn = amountNgn;
      payload.network = network;
      summary = `${cadence}: ₦${amountNgn} ${network} airtime to ${phoneNumber}, paid in ${token.symbol}`;
    } else {
      const recipientsRaw =
        (input.recipients as Array<{ address: string; amount: string }>) ?? [];
      if (!Array.isArray(recipientsRaw) || recipientsRaw.length === 0)
        throw new Error('Provide at least one recipient.');
      if (recipientsRaw.length > 200)
        throw new Error('Batch is limited to 200 recipients.');
      for (const r of recipientsRaw) {
        if (!/^0x[a-fA-F0-9]{40}$/.test(r.address))
          throw new Error(`Invalid address: ${r.address}`);
        if (!(Number(r.amount) > 0))
          throw new Error(`Invalid amount for ${r.address}`);
      }
      payload.recipients = recipientsRaw.map((r) => ({
        address: r.address,
        amount: String(r.amount),
      }));
      summary = `${cadence}: pay ${token.symbol} to ${recipientsRaw.length} recipient(s)`;
    }

    const schedule: PreparedSchedule = { id: uuidv4(), summary, payload };
    preparedSchedules.push(schedule);
    return {
      prepared: true,
      id: schedule.id,
      summary,
      note: 'The user must confirm this schedule in the app to save it.',
    };
  }
}
