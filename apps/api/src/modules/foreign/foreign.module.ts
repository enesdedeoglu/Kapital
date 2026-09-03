import { Module } from '@nestjs/common';
import { ForeignController } from './foreign.controller.js';
import { ForeignService } from './foreign.service.js';

@Module({ controllers: [ForeignController], providers: [ForeignService] })
export class ForeignModule {}
