import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type OrderStatus = 'pending' | 'processing' | 'fulfilled' | 'failed';

@Entity('airtime_orders')
export class AirtimeOrderEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** On-chain orderId emitted by BillPaymentInitiated (set after tx confirmed) */
  @Index({ unique: true, where: '"chainOrderId" IS NOT NULL' })
  @Column({ nullable: true, type: 'varchar' })
  chainOrderId: string | null;

  /** Chain the tx was submitted on */
  @Column({ type: 'int' })
  chainId: number;

  /** keccak256(phoneNumber) — matches recipientHash on-chain */
  @Column({ type: 'varchar' })
  recipientHash: string;

  /** Plain-text phone number — stored securely off-chain */
  @Column({ type: 'varchar' })
  phoneNumber: string;

  /** Nellobytesystems network code: 01=MTN, 02=GLO, 03=9mobile, 04=Airtel */
  @Column({ type: 'varchar', length: 2 })
  networkCode: string;

  /** NGN amount to top up */
  @Column({ type: 'int' })
  amountNgn: number;

  /** Tx hash from the frontend */
  @Column({ type: 'varchar', nullable: true })
  txHash: string | null;

  @Column({ type: 'varchar', default: 'pending' })
  status: OrderStatus;

  /** Nellobytesystems orderId after fulfillment */
  @Column({ type: 'varchar', nullable: true })
  providerOrderId: string | null;

  /** Provider response remark */
  @Column({ type: 'text', nullable: true })
  providerRemark: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
