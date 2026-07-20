import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class AgentMessageDto {
  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @ApiProperty({ example: 'Send ₦500 airtime to 08012345678 on MTN' })
  @IsString()
  content!: string;
}

export class AgentChatDto {
  @ApiProperty({ type: [AgentMessageDto], description: 'Full conversation so far' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AgentMessageDto)
  messages!: AgentMessageDto[];

  @ApiProperty({
    required: false,
    example: 42220,
    description: 'Chain the agent should prepare transactions for. Defaults to AGENT_DEFAULT_CHAIN_ID (Celo mainnet, 42220).',
  })
  @IsOptional()
  @IsInt()
  chainId?: number;

  @ApiProperty({ required: false, description: "Connected wallet address (the transaction sender)" })
  @IsOptional()
  @IsString()
  userAddress?: string;
}
