import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { UsersService } from './users.service';
import { UpsertUserDto } from './dto/user.dto';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Post()
  @ApiOperation({ summary: 'Create or update user profile' })
  upsert(@Body() dto: UpsertUserDto) {
    return this.service.upsert(dto);
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user profile' })
  getMe(@Request() req: { user: { address: string } }) {
    return this.service.findByAddress(req.user.address);
  }

  @Get(':address')
  @ApiOperation({ summary: 'Get user profile by wallet address' })
  getByAddress(@Param('address') address: string) {
    return this.service.findByAddress(address);
  }
}
