import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { UserEntity } from '../users/user.entity';
import { AirtimeOrderEntity } from '../airtime/airtime-order.entity';
import { ScheduleEntity } from '../schedules/schedule.entity';
import { ScheduleRunEntity } from '../schedules/schedule-run.entity';

/** Public, aggregate-only metrics — no per-user data, safe to expose unauthenticated. */
export interface GigipayMetrics {
  generatedAt: string;
  users: {
    total: number;
    miniPay: number;
    new7d: number;
    new30d: number;
  };
  airtime: {
    total: number;
    fulfilled: number;
    failed: number;
    pending: number;
    failedRatePct: number;
    volumeNgnFulfilled: number;
    byNetwork: Record<'MTN' | 'GLO' | '9MOBILE' | 'AIRTEL', number>;
    last7d: number;
    last30d: number;
  };
  schedules: {
    total: number;
    active: number;
    byKind: Record<'airtime' | 'batch-transfer', number>;
  };
  runs: {
    total: number;
    signed: number;
    fulfilled: number;
    pending: number;
    failed: number;
    /** Completed on-chain payments driven by schedules (signed + fulfilled). */
    completed: number;
    failedRatePct: number;
  };
  activity: {
    /** Distinct wallets with an airtime order or schedule in the window. */
    activeWallets7d: number;
    activeWallets30d: number;
  };
  /** Real product analytics from PostHog. null when PostHog isn't configured. */
  engagement: {
    dau: number;
    mau: number;
    /** DAU/MAU stickiness ratio as a percentage. */
    stickinessPct: number;
  } | null;
  /** Last 14 days of activity for a chart (oldest → newest). */
  daily: Array<{ date: string; airtime: number; runs: number }>;
}

const NETWORK_BY_CODE: Record<string, 'MTN' | 'GLO' | '9MOBILE' | 'AIRTEL'> = {
  '01': 'MTN',
  '02': 'GLO',
  '03': '9MOBILE',
  '04': 'AIRTEL',
};

const CACHE_TTL_MS = 60_000;

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  private cache: { at: number; data: GigipayMetrics } | null = null;

  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    @InjectRepository(AirtimeOrderEntity)
    private readonly orders: Repository<AirtimeOrderEntity>,
    @InjectRepository(ScheduleEntity)
    private readonly schedules: Repository<ScheduleEntity>,
    @InjectRepository(ScheduleRunEntity)
    private readonly runs: Repository<ScheduleRunEntity>,
    private readonly config: ConfigService,
  ) {}

  async getMetrics(): Promise<GigipayMetrics> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL_MS)
      return this.cache.data;
    const data = await this.compute();
    this.cache = { at: Date.now(), data };
    return data;
  }

  private since(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  private async compute(): Promise<GigipayMetrics> {
    const d7 = this.since(7);
    const d30 = this.since(30);

    const [
      usersTotal,
      usersMiniPay,
      usersNew7,
      usersNew30,
      airtimeAll,
      schedulesAll,
      runsAll,
      daily,
      activeWallets7d,
      activeWallets30d,
    ] = await Promise.all([
      this.users.count(),
      this.users.count({ where: { isMiniPay: true } }),
      this.users.count({ where: { createdAt: MoreThanOrEqual(d7) } }),
      this.users.count({ where: { createdAt: MoreThanOrEqual(d30) } }),
      this.orders.find({
        select: {
          status: true,
          amountNgn: true,
          networkCode: true,
          createdAt: true,
        },
      }),
      this.schedules.find({ select: { status: true, kind: true } }),
      this.runs.find({ select: { status: true, createdAt: true } }),
      this.dailySeries(14),
      this.activeWallets(d7),
      this.activeWallets(d30),
    ]);

    const engagement = await this.fetchEngagement();

    // Airtime aggregates
    const byNetwork = { MTN: 0, GLO: 0, '9MOBILE': 0, AIRTEL: 0 };
    let airtimeFulfilled = 0;
    let airtimeFailed = 0;
    let airtimePending = 0;
    let volumeNgnFulfilled = 0;
    let airtime7 = 0;
    let airtime30 = 0;
    for (const o of airtimeAll) {
      const net = NETWORK_BY_CODE[o.networkCode];
      if (net) byNetwork[net] += 1;
      if (o.status === 'fulfilled') {
        airtimeFulfilled += 1;
        volumeNgnFulfilled += o.amountNgn ?? 0;
      } else if (o.status === 'failed') airtimeFailed += 1;
      else airtimePending += 1;
      if (o.createdAt >= d7) airtime7 += 1;
      if (o.createdAt >= d30) airtime30 += 1;
    }
    const airtimeDecided = airtimeFulfilled + airtimeFailed;

    // Schedule aggregates
    let schedulesActive = 0;
    const scheduleByKind = { airtime: 0, 'batch-transfer': 0 };
    for (const s of schedulesAll) {
      if (s.status === 'active') schedulesActive += 1;
      if (s.kind in scheduleByKind)
        scheduleByKind[s.kind as 'airtime' | 'batch-transfer'] += 1;
    }

    // Run aggregates
    let runsSigned = 0;
    let runsFulfilled = 0;
    let runsPending = 0;
    let runsFailed = 0;
    for (const r of runsAll) {
      if (r.status === 'signed') runsSigned += 1;
      else if (r.status === 'fulfilled') runsFulfilled += 1;
      else if (r.status === 'pending') runsPending += 1;
      else if (r.status === 'failed') runsFailed += 1;
    }
    const runsCompleted = runsSigned + runsFulfilled;
    const runsDecided = runsCompleted + runsFailed;

    return {
      generatedAt: new Date().toISOString(),
      users: {
        total: usersTotal,
        miniPay: usersMiniPay,
        new7d: usersNew7,
        new30d: usersNew30,
      },
      airtime: {
        total: airtimeAll.length,
        fulfilled: airtimeFulfilled,
        failed: airtimeFailed,
        pending: airtimePending,
        failedRatePct: pct(airtimeFailed, airtimeDecided),
        volumeNgnFulfilled,
        byNetwork,
        last7d: airtime7,
        last30d: airtime30,
      },
      schedules: {
        total: schedulesAll.length,
        active: schedulesActive,
        byKind: scheduleByKind,
      },
      runs: {
        total: runsAll.length,
        signed: runsSigned,
        fulfilled: runsFulfilled,
        pending: runsPending,
        failed: runsFailed,
        completed: runsCompleted,
        failedRatePct: pct(runsFailed, runsDecided),
      },
      activity: { activeWallets7d, activeWallets30d },
      engagement,
      daily,
    };
  }

  /**
   * Real DAU (last 1 day) / MAU (last 30 days) from PostHog via the HogQL query
   * API — counts distinct identified persons (wallets). Returns null when
   * PostHog isn't configured or the query fails, so the stats page degrades
   * gracefully.
   */
  private async fetchEngagement(): Promise<GigipayMetrics['engagement']> {
    const apiKey = this.config.get<string>('posthog.apiKey');
    const projectId = this.config.get<string>('posthog.projectId');
    const host =
      this.config.get<string>('posthog.host') || 'https://us.posthog.com';
    if (!apiKey || !projectId) return null;

    const runQuery = async (days: number): Promise<number> => {
      const query = `SELECT count(DISTINCT person_id) AS c FROM events WHERE timestamp >= now() - INTERVAL ${days} DAY`;
      const res = await fetch(
        `${host}/api/projects/${projectId}/query/`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: { kind: 'HogQLQuery', query },
          }),
        },
      );
      if (!res.ok) throw new Error(`PostHog ${res.status}`);
      const json = (await res.json()) as { results?: Array<Array<number>> };
      return Number(json.results?.[0]?.[0] ?? 0);
    };

    try {
      const [dau, mau] = await Promise.all([runQuery(1), runQuery(30)]);
      return {
        dau,
        mau,
        stickinessPct: mau > 0 ? Math.round((dau / mau) * 1000) / 10 : 0,
      };
    } catch (err) {
      this.logger.warn(
        `PostHog engagement fetch failed: ${
          err instanceof Error ? err.message : err
        }`,
      );
      return null;
    }
  }

  /** Distinct owner/wallet addresses active (airtime txHash or schedule) since `from`. */
  private async activeWallets(from: Date): Promise<number> {
    const [scheduleOwners, orderTxs] = await Promise.all([
      this.schedules
        .createQueryBuilder('s')
        .select('DISTINCT s.ownerAddress', 'addr')
        .where('s.createdAt >= :from', { from })
        .getRawMany<{ addr: string }>(),
      // Airtime orders don't store the sender address; use distinct txHash as a
      // proxy for distinct on-chain payments in the window.
      this.orders
        .createQueryBuilder('o')
        .select('COUNT(DISTINCT o.txHash)', 'c')
        .where('o.createdAt >= :from', { from })
        .andWhere('o.txHash IS NOT NULL')
        .getRawOne<{ c: string }>(),
    ]);
    const owners = new Set(scheduleOwners.map((r) => r.addr?.toLowerCase()));
    return owners.size + Number(orderTxs?.c ?? 0);
  }

  /** Per-day counts of airtime orders and schedule runs for the last `days`. */
  private async dailySeries(
    days: number,
  ): Promise<Array<{ date: string; airtime: number; runs: number }>> {
    const from = this.since(days - 1);
    from.setHours(0, 0, 0, 0);

    const [airtimeRows, runRows] = await Promise.all([
      this.orders
        .createQueryBuilder('o')
        .select("to_char(date_trunc('day', o.createdAt), 'YYYY-MM-DD')", 'day')
        .addSelect('COUNT(*)', 'c')
        .where('o.createdAt >= :from', { from })
        .groupBy('day')
        .getRawMany<{ day: string; c: string }>(),
      this.runs
        .createQueryBuilder('r')
        .select("to_char(date_trunc('day', r.createdAt), 'YYYY-MM-DD')", 'day')
        .addSelect('COUNT(*)', 'c')
        .where('r.createdAt >= :from', { from })
        .groupBy('day')
        .getRawMany<{ day: string; c: string }>(),
    ]);

    const airtimeByDay = new Map(airtimeRows.map((r) => [r.day, Number(r.c)]));
    const runsByDay = new Map(runRows.map((r) => [r.day, Number(r.c)]));

    const out: Array<{ date: string; airtime: number; runs: number }> = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(from);
      d.setDate(from.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      out.push({
        date: key,
        airtime: airtimeByDay.get(key) ?? 0,
        runs: runsByDay.get(key) ?? 0,
      });
    }
    return out;
  }
}

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 10; // one decimal
}
