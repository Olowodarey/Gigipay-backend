import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type ScheduleRunStatus =
  | 'pending' // materialized, waiting for the user to confirm & sign
  | 'signed' // user signed; tx hash recorded, awaiting fulfilment
  | 'fulfilled' // completed end-to-end
  | 'failed' // signing/fulfilment failed
  | 'skipped'; // cancelled/paused before the user acted

/**
 * One occurrence of a schedule. Notify-and-confirm: the cron worker creates a
 * `pending` run each cycle; the user is prompted, then signs it in their wallet.
 * The (scheduleId, cycle) unique index makes materialization idempotent.
 */
@Entity('schedule_runs')
@Index(['scheduleId', 'cycle'], { unique: true })
export class ScheduleRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  scheduleId: string;

  /** 0-based occurrence number within its schedule. */
  @Column({ type: 'int' })
  cycle: number;

  @Column({ type: 'timestamptz' })
  dueAt: Date;

  @Column({ type: 'varchar', default: 'pending' })
  status: ScheduleRunStatus;

  /** Tx hash once the user signs. */
  @Column({ type: 'varchar', nullable: true })
  txHash: string | null;

  /** Failure reason / provider remark. */
  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
