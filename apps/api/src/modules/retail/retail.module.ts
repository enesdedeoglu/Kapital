import { Module } from '@nestjs/common';
import { RetailController } from './retail.controller.js';
import { RetailService } from './retail.service.js';

@Module({ controllers: [RetailController], providers: [RetailService] })
export class RetailModule {}
