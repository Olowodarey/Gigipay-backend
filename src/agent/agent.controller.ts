import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { AgentService } from './agent.service';
import { AgentChatDto } from './dto/agent.dto';

@ApiTags('agent')
@Controller('agent')
export class AgentController {
  constructor(private readonly service: AgentService) {}

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Send a message to the GigiPay Agent (local rule-based engine, no external LLM). Returns a reply plus any transactions/schedules to sign and any data actions for the frontend to fulfil.',
  })
  chat(@Body() dto: AgentChatDto) {
    return this.service.chat(dto);
  }
}
