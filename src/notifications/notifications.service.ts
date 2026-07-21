import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as webpush from 'web-push';
import { PushSubscriptionEntity } from './push-subscription.entity';

export interface WebPushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushMessage {
  title: string;
  body: string;
  url?: string;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private enabled = false;

  constructor(
    @InjectRepository(PushSubscriptionEntity)
    private readonly subs: Repository<PushSubscriptionEntity>,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const publicKey = this.config.get<string>('vapid.publicKey');
    const privateKey = this.config.get<string>('vapid.privateKey');
    const subject = this.config.get<string>('vapid.subject');
    if (publicKey && privateKey) {
      webpush.setVapidDetails(
        subject || 'mailto:admin@gigipay.app',
        publicKey,
        privateKey,
      );
      this.enabled = true;
    } else {
      this.logger.warn(
        'VAPID keys not set — Web Push notifications are disabled.',
      );
    }
  }

  get vapidPublicKey(): string {
    return this.config.get<string>('vapid.publicKey') || '';
  }

  /** Save (or refresh) a browser push subscription for a wallet owner. */
  async subscribe(
    ownerAddress: string,
    sub: WebPushSubscriptionInput,
  ): Promise<{ ok: true }> {
    const owner = ownerAddress.toLowerCase();
    const existing = await this.subs.findOne({
      where: { endpoint: sub.endpoint },
    });
    if (existing) {
      existing.ownerAddress = owner;
      existing.p256dh = sub.keys.p256dh;
      existing.auth = sub.keys.auth;
      await this.subs.save(existing);
    } else {
      await this.subs.save(
        this.subs.create({
          ownerAddress: owner,
          endpoint: sub.endpoint,
          p256dh: sub.keys.p256dh,
          auth: sub.keys.auth,
        }),
      );
    }
    return { ok: true };
  }

  async unsubscribe(endpoint: string): Promise<{ ok: true }> {
    await this.subs.delete({ endpoint });
    return { ok: true };
  }

  /** Send a push message to every subscription owned by an address. */
  async notify(ownerAddress: string, message: PushMessage): Promise<void> {
    if (!this.enabled) return;
    const owner = ownerAddress.toLowerCase();
    const subscriptions = await this.subs.find({
      where: { ownerAddress: owner },
    });
    if (subscriptions.length === 0) return;

    const payload = JSON.stringify(message);
    await Promise.all(
      subscriptions.map(async (s) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: s.endpoint,
              keys: { p256dh: s.p256dh, auth: s.auth },
            },
            payload,
          );
        } catch (err: unknown) {
          const statusCode =
            typeof err === 'object' && err !== null && 'statusCode' in err
              ? (err as { statusCode?: number }).statusCode
              : undefined;
          // 404/410 = subscription expired/gone → prune it.
          if (statusCode === 404 || statusCode === 410) {
            await this.subs.delete({ id: s.id });
          } else {
            this.logger.warn(
              `Push to ${s.endpoint.slice(0, 40)}… failed: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
      }),
    );
  }
}
