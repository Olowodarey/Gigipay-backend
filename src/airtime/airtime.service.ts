import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { BlockchainService } from '../blockchain/blockchain.service';
import {
  BuyAirtimeDto,
  QueryAirtimeDto,
  CancelAirtimeDto,
  BuildAirtimePayBillDto,
} from './dto/airtime.dto';
import type { Address } from 'viem';
import { keccak256, encodePacked } from 'viem';

/** Raw response shape from nellobytesystems */
interface NelloResponse {
  orderid?: string;
  statuscode?: string;
  status?: string;
  remark?: string;
  ordertype?: string;
  mobilenetwork?: string;
  mobilenumber?: string;
  amountcharged?: string;
  walletbalance?: string;
  date?: string;
  requestid?: string;
}

@Injectable()
export class AirtimeService {
  private readonly logger = new Logger(AirtimeService.name);
  private readonly baseUrl = 'https://www.nellobytesystems.com';

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService,
    private readonly blockchain: BlockchainService,
  ) {}

  // ─── Tx Builder ──────────────────────────────────────────────────────────

  /**
   * Build a payBill transaction for the frontend to sign.
   * serviceType = "airtime", serviceId = network code (01/02/03/04)
   */
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

  // ─── Nellobytesystems API ─────────────────────────────────────────────────

  /** Buy airtime via nellobytesystems API */
  async buyAirtime(dto: BuyAirtimeDto): Promise<NelloResponse> {
    const userId = this.config.get<string>('nello.userId');
    const apiKey = this.config.get<string>('nello.apiKey');
    const callbackUrl = this.config.get<string>('nello.callbackUrl');
    const requestId = dto.requestId ?? uuidv4();

    const params = new URLSearchParams({
      UserID: userId,
      APIKey: apiKey,
      MobileNetwork: dto.networkCode,
      Amount: String(dto.amount),
      MobileNumber: dto.phoneNumber,
      RequestID: requestId,
      CallBackURL: callbackUrl,
      ...(dto.bonusType ? { BonusType: dto.bonusType } : {}),
    });

    const url = `${this.baseUrl}/APIAirtimeV1.asp?${params.toString()}`;
    this.logger.log(
      `Buying airtime → ${dto.phoneNumber} | network=${dto.networkCode} | amount=${dto.amount}`,
    );

    const response = await this.callNello<NelloResponse>(url);
    this.logger.log(`Airtime response: ${JSON.stringify(response)}`);
    return response;
  }

  /** Query a transaction by orderId or requestId */
  async queryTransaction(dto: QueryAirtimeDto): Promise<NelloResponse> {
    if (!dto.orderId && !dto.requestId) {
      throw new BadRequestException('Provide either orderId or requestId');
    }

    const userId = this.config.get<string>('nello.userId');
    const apiKey = this.config.get<string>('nello.apiKey');

    const params = new URLSearchParams({ UserID: userId, APIKey: apiKey });
    if (dto.orderId) params.set('OrderID', dto.orderId);
    else params.set('RequestID', dto.requestId!);

    const url = `${this.baseUrl}/APIQueryV1.asp?${params.toString()}`;
    return this.callNello<NelloResponse>(url);
  }

  /** Cancel a transaction by orderId */
  async cancelTransaction(dto: CancelAirtimeDto): Promise<NelloResponse> {
    const userId = this.config.get<string>('nello.userId');
    const apiKey = this.config.get<string>('nello.apiKey');

    const params = new URLSearchParams({
      UserID: userId,
      APIKey: apiKey,
      OrderID: dto.orderId,
    });

    const url = `${this.baseUrl}/APICancelV1.asp?${params.toString()}`;
    return this.callNello<NelloResponse>(url);
  }

  /** Fetch available networks and discount rates */
  async getNetworks(): Promise<NelloResponse> {
    const userId = this.config.get<string>('nello.userId');
    const url = `${this.baseUrl}/APIAirtimeDiscountV2.asp?UserID=${userId}`;
    return this.callNello<NelloResponse>(url);
  }

  // ─── On-chain event fulfillment ───────────────────────────────────────────

  /**
   * Called by the blockchain listener when a BillPaymentInitiated event
   * is emitted with serviceType = "airtime".
   */
  async fulfillFromChainEvent(event: {
    orderId: bigint;
    networkCode: string;
    phoneNumber: string;
    amountNgn: number;
  }): Promise<void> {
    this.logger.log(
      `Fulfilling on-chain airtime order #${event.orderId} → ${event.phoneNumber}`,
    );

    try {
      const result = await this.buyAirtime({
        networkCode: event.networkCode as any,
        amount: event.amountNgn,
        phoneNumber: event.phoneNumber,
        requestId: `chain-${event.orderId.toString()}`,
      });

      if (result.statuscode === '100' || result.statuscode === '200') {
        this.logger.log(`Order #${event.orderId} fulfilled: ${result.status}`);
      } else {
        this.logger.error(
          `Order #${event.orderId} failed: ${result.status} — ${result.remark}`,
        );
      }
    } catch (err) {
      this.logger.error(`Failed to fulfill order #${event.orderId}`, err);
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async callNello<T>(url: string): Promise<T> {
    try {
      const { data } = await firstValueFrom(this.http.get<T>(url));
      return data;
    } catch (err: any) {
      this.logger.error(`Nello API error: ${err?.message}`);
      throw new InternalServerErrorException('Airtime provider request failed');
    }
  }
}
