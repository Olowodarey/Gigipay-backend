import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { keccak256, encodePacked } from 'viem';
import type { Address } from 'viem';
import { BlockchainService } from '../blockchain/blockchain.service';
import {
  BuyAirtimeDto,
  QueryAirtimeDto,
  CancelAirtimeDto,
  BuildAirtimePayBillDto,
  NelloResponse,
  type MobileNetworkCode,
} from './dto/airtime.dto';
import { RegisterAirtimeOrderDto } from './dto/register-order.dto';
import { AirtimeOrderEntity } from './airtime-order.entity';

@Injectable()
export class AirtimeService {
  private readonly logger = new Logger(AirtimeService.name);
  private readonly baseUrl = 'https://www.nellobytesystems.com';

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService,
    private readonly blockchain: BlockchainService,
    @InjectRepository(AirtimeOrderEntity)
    private readonly orderRepo: Repository<AirtimeOrderEntity>,
  ) {}

  // ─── Tx Builder ──────────────────────────────────────────────────────────

  buildPayBillTx(dto: BuildAirtimePayBillDto) {
    const recipientHash = keccak256(
      encodePacked(['string'], [dto.phoneNumber]),
    );
    const tx = this.blockchain.buildPayBillTx(
      dto.chainId,
      dto.token as Address,
      BigInt(dto.amount),
      'airtime',
      dto.networkCode,
      recipientHash,
    );
    return { ...tx, value: tx.value?.toString() };
  }

  // ─── Order Registration ───────────────────────────────────────────────────

  /**
   * Frontend calls this AFTER the tx is confirmed on-chain.
   * Stores the plain-text phone number so the listener can fulfill the order.
   */
  async registerOrder(
    dto: RegisterAirtimeOrderDto,
  ): Promise<AirtimeOrderEntity> {
    const recipientHash = keccak256(
      encodePacked(['string'], [dto.phoneNumber]),
    );

    const order = this.orderRepo.create({
      chainId: dto.chainId,
      chainOrderId: dto.chainOrderId ?? null,
      recipientHash,
      phoneNumber: dto.phoneNumber,
      networkCode: dto.networkCode,
      amountNgn: dto.amountNgn,
      txHash: dto.txHash,
      status: 'pending',
    });

    const saved = await this.orderRepo.save(order);
    this.logger.log(
      `Order registered: id=${saved.id} phone=${dto.phoneNumber} amount=₦${dto.amountNgn}`,
    );

    // If chainOrderId already known, fulfill immediately
    if (dto.chainOrderId) {
      void this.fulfillOrder(saved);
    }

    return saved;
  }

  /** Update chainOrderId once the event is parsed from the chain */
  async attachChainOrderId(
    txHash: string,
    chainOrderId: string,
  ): Promise<void> {
    const order = await this.orderRepo.findOne({ where: { txHash } });
    if (!order) return;

    order.chainOrderId = chainOrderId;
    await this.orderRepo.save(order);
    void this.fulfillOrder(order);
  }

  // ─── Fulfillment ──────────────────────────────────────────────────────────

  async fulfillOrder(order: AirtimeOrderEntity): Promise<void> {
    if (order.status !== 'pending') return;

    order.status = 'processing';
    await this.orderRepo.save(order);

    this.logger.log(
      `Fulfilling order ${order.id} → ₦${order.amountNgn} to ${order.phoneNumber} (${order.networkCode})`,
    );

    try {
      const result = await this.buyAirtime({
        networkCode: order.networkCode as MobileNetworkCode,
        amount: order.amountNgn,
        phoneNumber: order.phoneNumber,
        requestId: `order-${order.id}`,
      });

      const success =
        result.statuscode === '100' || result.statuscode === '200';

      order.status = success ? 'fulfilled' : 'failed';
      order.providerOrderId = result.orderid ?? null;
      order.providerRemark = result.remark ?? result.status ?? null;
      await this.orderRepo.save(order);

      this.logger.log(
        `Order ${order.id} ${order.status}: ${order.providerRemark}`,
      );
    } catch (err) {
      order.status = 'failed';
      order.providerRemark =
        err instanceof Error ? err.message : 'Unknown error';
      await this.orderRepo.save(order);
      this.logger.error(`Order ${order.id} fulfillment failed`, err);
    }
  }

  /** Called by the blockchain event listener */
  async fulfillFromChainEvent(event: {
    orderId: bigint;
    txHash: string;
    chainId: number;
  }): Promise<void> {
    const chainOrderId = event.orderId.toString();

    // Try to find by txHash first (registered before event arrived)
    const order = await this.orderRepo.findOne({
      where: { txHash: event.txHash },
    });

    if (order) {
      order.chainOrderId = chainOrderId;
      await this.orderRepo.save(order);
      await this.fulfillOrder(order);
    } else {
      this.logger.warn(
        `BillPaymentInitiated event for orderId=${chainOrderId} has no matching registered order yet`,
      );
    }
  }

  async getOrder(id: string): Promise<AirtimeOrderEntity> {
    const order = await this.orderRepo.findOne({ where: { id } });
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }

  // ─── Nellobytesystems API ─────────────────────────────────────────────────

  async buyAirtime(dto: BuyAirtimeDto): Promise<NelloResponse> {
    const userId = this.config.get<string>('nello.userId') ?? '';
    const apiKey = this.config.get<string>('nello.apiKey') ?? '';
    const callbackUrl = this.config.get<string>('nello.callbackUrl') ?? '';
    const requestId = dto.requestId ?? uuidv4();

    const params = new URLSearchParams({
      UserID: userId,
      APIKey: apiKey,
      MobileNetwork: dto.networkCode,
      Amount: String(dto.amount),
      MobileNumber: dto.phoneNumber,
      RequestID: requestId,
      CallBackURL: callbackUrl,
    });
    if (dto.bonusType) params.set('BonusType', dto.bonusType);

    const url = `${this.baseUrl}/APIAirtimeV1.asp?${params.toString()}`;
    this.logger.log(
      `Buying airtime → ${dto.phoneNumber} | network=${dto.networkCode} | amount=₦${dto.amount}`,
    );

    const response = await this.callNello<NelloResponse>(url);
    this.logger.log(`Nello response: ${JSON.stringify(response)}`);
    return response;
  }

  async queryTransaction(dto: QueryAirtimeDto): Promise<NelloResponse> {
    if (!dto.orderId && !dto.requestId) {
      throw new BadRequestException('Provide either orderId or requestId');
    }
    const userId = this.config.get<string>('nello.userId') ?? '';
    const apiKey = this.config.get<string>('nello.apiKey') ?? '';

    const params = new URLSearchParams({ UserID: userId, APIKey: apiKey });
    if (dto.orderId) params.set('OrderID', dto.orderId);
    else params.set('RequestID', dto.requestId!);

    return this.callNello<NelloResponse>(
      `${this.baseUrl}/APIQueryV1.asp?${params.toString()}`,
    );
  }

  async cancelTransaction(dto: CancelAirtimeDto): Promise<NelloResponse> {
    const userId = this.config.get<string>('nello.userId') ?? '';
    const apiKey = this.config.get<string>('nello.apiKey') ?? '';

    const params = new URLSearchParams({
      UserID: userId,
      APIKey: apiKey,
      OrderID: dto.orderId,
    });

    return this.callNello<NelloResponse>(
      `${this.baseUrl}/APICancelV1.asp?${params.toString()}`,
    );
  }

  async getNetworks(): Promise<NelloResponse> {
    const userId = this.config.get<string>('nello.userId') ?? '';
    return this.callNello<NelloResponse>(
      `${this.baseUrl}/APIAirtimeDiscountV2.asp?UserID=${userId}`,
    );
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async callNello<T>(url: string): Promise<T> {
    try {
      const { data } = await firstValueFrom(this.http.get<T>(url));
      return data;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Nello API error: ${msg}`);
      throw new InternalServerErrorException('Airtime provider request failed');
    }
  }
}
