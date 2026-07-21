import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import {
  NotificationsService,
  type WebPushSubscriptionInput,
} from './notifications.service';

type AuthedReq = { user: { address: string } };

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get('vapid-public-key')
  @ApiOperation({ summary: 'Public VAPID key for Web Push subscription' })
  vapidKey() {
    return { publicKey: this.service.vapidPublicKey };
  }

  @Post('subscribe')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Register a browser push subscription' })
  subscribe(
    @Request() req: AuthedReq,
    @Body() sub: WebPushSubscriptionInput,
  ) {
    return this.service.subscribe(req.user.address, sub);
  }

  @Post('unsubscribe')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a browser push subscription' })
  unsubscribe(@Body('endpoint') endpoint: string) {
    return this.service.unsubscribe(endpoint);
  }
}
