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
      'Send a message to the GigiPay Agent. Returns a reply plus any transactions the user should review and sign.',
  })
  chat(@Body() dto: AgentChatDto) {
    return this.service.chat(dto);
  }
}
