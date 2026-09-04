import { Module } from '@nestjs/common';
import { StandingController } from './standing.controller.js';
import { StandingService } from './standing.service.js';

@Module({ controllers: [StandingController], providers: [StandingService] })
export class StandingModule {}
