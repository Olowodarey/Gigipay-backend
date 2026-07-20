import { Module } from '@nestjs/common';
import { AgentController } from './agent.controller';
import { AgentService } from './agent.service';
import { BlockchainModule } from '../blockchain/blockchain.module';
import { RatesModule } from '../rates/rates.module';

@Module({
  imports: [BlockchainModule, RatesModule],
  controllers: [AgentController],
  providers: [AgentService],
})
export class AgentModule {}
