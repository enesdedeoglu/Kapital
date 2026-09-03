import { Module } from '@nestjs/common';
import { MarketController } from './market.controller.js';
import { MarketService } from './market.service.js';
import { OrderService } from './order.service.js';

@Module({ controllers: [MarketController], providers: [MarketService, OrderService] })
export class MarketModule {}
