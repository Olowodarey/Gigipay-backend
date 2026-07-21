import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type ScheduleKind = 'airtime' | 'batch-transfer';
export type ScheduleCadence = 'daily' | 'weekly' | 'monthly';
export type ScheduleStatus = 'active' | 'paused' | 'cancelled' | 'completed';

/** Params needed to rebuild the calldata each cycle (never store keys). */
export interface AirtimeScheduleParams {
  phoneNumber: string;
  amountNgn: number;
  network: string; // MTN | GLO | AIRTEL | 9MOBILE
}
export interface BatchTransferScheduleParams {
  recipients: { address: string; amount: string }[]; // human token units
}
export type ScheduleParams =
  | AirtimeScheduleParams
  | BatchTransferScheduleParams;

@Entity('schedules')
export class ScheduleEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Owner's wallet address, lowercased (from the JWT). */
  @Index()
  @Column({ type: 'varchar' })
  ownerAddress: string;

  @Column({ type: 'int' })
  chainId: number;

  @Column({ type: 'varchar' })
  kind: ScheduleKind;

  @Column({ type: 'varchar' })
  tokenSymbol: string;

  /** Recurring payment parameters — shape depends on `kind`. */
  @Column({ type: 'jsonb' })
  params: ScheduleParams;

  @Column({ type: 'varchar' })
  cadence: ScheduleCadence;

  /** When the next occurrence is due. Indexed — the cron worker scans this. */
  @Index()
  @Column({ type: 'timestamptz' })
  nextRunAt: Date;

  /** Optional hard stop. Null = runs until paused/cancelled. */
  @Column({ type: 'timestamptz', nullable: true })
  endAt: Date | null;

  @Column({ type: 'varchar', default: 'active' })
  status: ScheduleStatus;

  /** Per-run spend cap in USD. Null = fall back to the global agent cap. */
  @Column({ type: 'numeric', nullable: true })
  spendCapUsd: string | null;

  /** Friendly label, e.g. "Airtime for Mum". */
  @Column({ type: 'varchar', nullable: true })
  label: string | null;

  /** Number of run-occurrences materialized so far (drives the cycle number). */
  @Column({ type: 'int', default: 0 })
  cyclesCreated: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
