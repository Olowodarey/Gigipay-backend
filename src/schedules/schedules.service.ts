import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import {
  encodeFunctionData,
  keccak256,
  encodePacked,
  parseUnits,
  type Address,
} from 'viem';
import { BlockchainService } from '../blockchain/blockchain.service';
import { RatesService } from '../rates/rates.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  NETWORK_CODES,
  resolveToken,
  type PaymentToken,
} from '../blockchain/payment-tokens';
import type { PreparedTx } from '../agent/agent.service';
import {
  ScheduleEntity,
  type ScheduleCadence,
  type AirtimeScheduleParams,
  type BatchTransferScheduleParams,
} from './schedule.entity';
import { ScheduleRunEntity } from './schedule-run.entity';
import { CreateScheduleDto } from './dto/schedule.dto';

@Injectable()
export class SchedulesService {
  private readonly logger = new Logger(SchedulesService.name);
  private readonly defaultChainId: number;
  private readonly globalMaxSpendUsd: number;

  constructor(
    @InjectRepository(ScheduleEntity)
    private readonly schedules: Repository<ScheduleEntity>,
    @InjectRepository(ScheduleRunEntity)
    private readonly runs: Repository<ScheduleRunEntity>,
    private readonly config: ConfigService,
    private readonly blockchain: BlockchainService,
    private readonly rates: RatesService,
    private readonly notifications: NotificationsService,
  ) {
    this.defaultChainId =
      this.config.get<number>('agent.defaultChainId') ?? 42220;
    this.globalMaxSpendUsd = this.config.get<number>('agent.maxSpendUsd') ?? 50;
  }

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  async create(
    ownerAddress: string,
    dto: CreateScheduleDto,
  ): Promise<ScheduleEntity> {
    const chainId = dto.chainId ?? this.defaultChainId;
    // Validate token exists on the chain (throws a friendly error otherwise).
    resolveToken(chainId, dto.tokenSymbol);

    const params = this.validateParams(dto);
    const startAt = dto.startAt ? new Date(dto.startAt) : new Date();
    if (Number.isNaN(startAt.getTime()))
      throw new BadRequestException('Invalid startAt date.');
    const endAt = dto.endAt ? new Date(dto.endAt) : null;
    if (endAt && Number.isNaN(endAt.getTime()))
      throw new BadRequestException('Invalid endAt date.');

    const schedule = this.schedules.create({
      ownerAddress: ownerAddress.toLowerCase(),
      chainId,
      kind: dto.kind,
      tokenSymbol: dto.tokenSymbol,
      params,
      cadence: dto.cadence,
      nextRunAt: startAt,
      endAt,
      status: 'active',
      spendCapUsd: dto.spendCapUsd != null ? String(dto.spendCapUsd) : null,
      label: dto.label ?? null,
      cyclesCreated: 0,
    });
    return this.schedules.save(schedule);
  }

  findByOwner(ownerAddress: string): Promise<ScheduleEntity[]> {
    return this.schedules.find({
      where: { ownerAddress: ownerAddress.toLowerCase() },
      order: { createdAt: 'DESC' },
    });
  }

  async setStatus(
    id: string,
    ownerAddress: string,
    status: 'active' | 'paused' | 'cancelled',
  ): Promise<ScheduleEntity> {
    const schedule = await this.ownedSchedule(id, ownerAddress);
    if (schedule.status === 'completed')
      throw new BadRequestException('Schedule already completed.');
    if (schedule.status === 'cancelled')
      throw new BadRequestException('Schedule already cancelled.');
    // Resuming from pause: don't fire everything missed — move nextRunAt forward.
    if (status === 'active' && schedule.nextRunAt.getTime() < Date.now()) {
      schedule.nextRunAt = this.computeNext(new Date(), schedule.cadence);
    }
    schedule.status = status;
    return this.schedules.save(schedule);
  }

  // ─── Runs (notify-and-confirm) ───────────────────────────────────────────────

  /** Pending runs for this owner, newest first, with their parent schedule. */
  async listRuns(ownerAddress: string): Promise<
    Array<ScheduleRunEntity & { schedule: ScheduleEntity | null }>
  > {
    const owned = await this.findByOwner(ownerAddress);
    const byId = new Map(owned.map((s) => [s.id, s]));
    if (owned.length === 0) return [];
    const runs = await this.runs.find({
      where: owned.map((s) => ({ scheduleId: s.id })),
      order: { dueAt: 'DESC' },
      take: 100,
    });
    return runs.map((r) => ({ ...r, schedule: byId.get(r.scheduleId) ?? null }));
  }

  /** Build the signable calldata for a pending run (the user signs in-wallet). */
  async prepareRun(
    runId: string,
    ownerAddress: string,
  ): Promise<PreparedTx> {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException('Run not found.');
    const schedule = await this.ownedSchedule(run.scheduleId, ownerAddress);
    if (run.status !== 'pending')
      throw new BadRequestException(`Run is already ${run.status}.`);
    return this.buildPreparedTx(schedule, run);
  }

  async markSigned(
    runId: string,
    ownerAddress: string,
    txHash: string,
  ): Promise<ScheduleRunEntity> {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException('Run not found.');
    await this.ownedSchedule(run.scheduleId, ownerAddress); // ownership check
    run.status = 'signed';
    run.txHash = txHash;
    return this.runs.save(run);
  }

  // ─── Cron worker ─────────────────────────────────────────────────────────────

  /**
   * Every minute, materialize any due occurrences into `pending` runs and advance
   * each schedule's nextRunAt. Notify-and-confirm: we do NOT execute here — the
   * user confirms and signs each run themselves.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async materializeDueRuns(): Promise<void> {
    const now = new Date();
    const due = await this.schedules.find({
      where: { status: 'active', nextRunAt: LessThanOrEqual(now) },
      take: 200,
    });
    for (const schedule of due) {
      try {
        await this.materializeOne(schedule, now);
      } catch (err) {
        this.logger.error(
          `Failed to materialize schedule ${schedule.id}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
  }

  private async materializeOne(
    schedule: ScheduleEntity,
    now: Date,
  ): Promise<void> {
    // Past its end date → complete without creating a run.
    if (schedule.endAt && now > schedule.endAt) {
      schedule.status = 'completed';
      await this.schedules.save(schedule);
      return;
    }

    const cycle = schedule.cyclesCreated;
    // Idempotent: unique (scheduleId, cycle) guards against double-fire.
    const exists = await this.runs.findOne({
      where: { scheduleId: schedule.id, cycle },
    });
    if (!exists) {
      await this.runs.save(
        this.runs.create({
          scheduleId: schedule.id,
          cycle,
          dueAt: schedule.nextRunAt,
          status: 'pending',
        }),
      );
      // Notify the owner that a payment is ready to approve.
      const frontendUrl =
        this.config.get<string>('frontendUrl') || 'http://localhost:3000';
      await this.notifications.notify(schedule.ownerAddress, {
        title: 'Payment due',
        body: `${schedule.label || this.describe(schedule)} is ready to approve.`,
        url: `${frontendUrl}/schedules`,
      });
    }

    schedule.cyclesCreated = cycle + 1;
    const next = this.computeNext(schedule.nextRunAt, schedule.cadence);
    if (schedule.endAt && next > schedule.endAt) {
      schedule.status = 'completed';
    } else {
      schedule.nextRunAt = next;
    }
    await this.schedules.save(schedule);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private async ownedSchedule(
    id: string,
    ownerAddress: string,
  ): Promise<ScheduleEntity> {
    const schedule = await this.schedules.findOne({ where: { id } });
    if (!schedule || schedule.ownerAddress !== ownerAddress.toLowerCase())
      throw new NotFoundException('Schedule not found.');
    return schedule;
  }

  private validateParams(dto: CreateScheduleDto) {
    if (dto.kind === 'airtime') {
      const phoneNumber = String(dto.phoneNumber ?? '').trim();
      const amountNgn = Number(dto.amountNgn);
      const network = String(dto.network ?? '').toUpperCase();
      if (!/^0[7-9][01]\d{8}$/.test(phoneNumber))
        throw new BadRequestException(
          'Invalid Nigerian phone number (expected 11 digits like 08012345678).',
        );
      if (!(amountNgn >= 50 && amountNgn <= 200000))
        throw new BadRequestException('Airtime amount must be ₦50–₦200,000.');
      if (!NETWORK_CODES[network])
        throw new BadRequestException(
          'Network must be MTN, GLO, AIRTEL or 9MOBILE.',
        );
      return { phoneNumber, amountNgn, network } as AirtimeScheduleParams;
    }
    // batch-transfer
    const recipients = dto.recipients ?? [];
    if (recipients.length === 0)
      throw new BadRequestException('Provide at least one recipient.');
    if (recipients.length > 200)
      throw new BadRequestException('Batch is limited to 200 recipients.');
    for (const r of recipients) {
      if (!/^0x[a-fA-F0-9]{40}$/.test(r.address))
        throw new BadRequestException(`Invalid address: ${r.address}`);
      if (!(Number(r.amount) > 0))
        throw new BadRequestException(`Invalid amount for ${r.address}`);
    }
    return { recipients } as BatchTransferScheduleParams;
  }

  private describe(schedule: ScheduleEntity): string {
    if (schedule.kind === 'airtime') {
      const p = schedule.params as AirtimeScheduleParams;
      return `₦${p.amountNgn} ${p.network} airtime`;
    }
    const p = schedule.params as BatchTransferScheduleParams;
    return `Payroll to ${p.recipients.length} recipient(s)`;
  }

  private computeNext(from: Date, cadence: ScheduleCadence): Date {
    const d = new Date(from);
    if (cadence === 'daily') d.setDate(d.getDate() + 1);
    else if (cadence === 'weekly') d.setDate(d.getDate() + 7);
    else d.setMonth(d.getMonth() + 1);
    return d;
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
      if (!anyRate || !anyRate.usd)
        throw new BadRequestException('Rate unavailable right now.');
      const ngnPerUsd = anyRate.ngn / anyRate.usd;
      return (amountNgn / ngnPerUsd).toFixed(6);
    }
    const { tokenAmount } = await this.rates.convertNgnToToken(
      chainId,
      amountNgn,
    );
    return tokenAmount;
  }

  private effectiveCapUsd(schedule: ScheduleEntity): number {
    const perRun = schedule.spendCapUsd ? Number(schedule.spendCapUsd) : null;
    if (perRun != null) return Math.min(perRun, this.globalMaxSpendUsd);
    return this.globalMaxSpendUsd;
  }

  private async buildPreparedTx(
    schedule: ScheduleEntity,
    run: ScheduleRunEntity,
  ): Promise<PreparedTx> {
    const { chainId } = schedule;
    const token = resolveToken(chainId, schedule.tokenSymbol);
    const cap = this.effectiveCapUsd(schedule);

    if (schedule.kind === 'airtime') {
      const p = schedule.params as AirtimeScheduleParams;
      if (p.amountNgn / this.approxNgnPerUsd(await this.rates.getAllRates()) > cap)
        throw new BadRequestException(
          `This run exceeds the $${cap} spend cap.`,
        );
      const networkCode = NETWORK_CODES[p.network.toUpperCase()];
      const human = await this.quoteHuman(chainId, p.amountNgn, token);
      const amountBase = parseUnits(human, token.decimals);
      const recipientHash = keccak256(encodePacked(['string'], [p.phoneNumber]));
      const built = this.blockchain.buildPayBillTx(
        chainId,
        token.address,
        amountBase,
        'airtime',
        networkCode,
        recipientHash,
      );
      return {
        id: run.id,
        kind: 'airtime',
        summary: `₦${p.amountNgn} ${p.network} airtime to ${p.phoneNumber} — pay ${human} ${token.symbol}`,
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
          payload: {
            chainId,
            networkCode,
            phoneNumber: p.phoneNumber,
            amountNgn: p.amountNgn,
          },
        },
      };
    }

    // batch-transfer
    const p = schedule.params as BatchTransferScheduleParams;
    const recipients: Address[] = [];
    const amounts: bigint[] = [];
    for (const r of p.recipients) {
      recipients.push(r.address as Address);
      amounts.push(parseUnits(String(r.amount), token.decimals));
    }
    const total = amounts.reduce((a, b) => a + b, 0n);
    if (token.isStable) {
      const totalHuman = Number(p.recipients.reduce((a, r) => a + Number(r.amount), 0));
      if (totalHuman > cap)
        throw new BadRequestException(
          `This run ($${totalHuman}) exceeds the $${cap} spend cap.`,
        );
    }
    const built = this.blockchain.buildBatchTransferTx(
      chainId,
      token.address,
      recipients,
      amounts,
    );
    return {
      id: run.id,
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

  private approxNgnPerUsd(rates: Record<string, unknown>): number {
    const anyRate = Object.values(rates)[0] as
      | { ngn: number; usd: number }
      | undefined;
    if (!anyRate || !anyRate.usd) return 1600; // conservative fallback
    return anyRate.ngn / anyRate.usd;
  }
}
