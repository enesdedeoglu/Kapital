import {
  Body, Controller, Delete, Get, Inject, Param, Post, Query, Req, UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { ZodPipe } from '../../common/zod.pipe.js';
import { IdempotencyInterceptor } from '../../common/idempotency.interceptor.js';
import type { AuthUser } from '../auth/jwt.guard.js';
import { MarketService } from './market.service.js';
import { buySchema, type BuyDto } from './market.dto.js';
import { OrderService } from './order.service.js';
import { placeOrderSchema, type PlaceOrderDto } from './order.dto.js';

@Controller('market')
export class MarketController {
  constructor(
    @Inject(MarketService) private readonly market: MarketService,
    @Inject(OrderService) private readonly orders: OrderService,
  ) {}

  /** Emir defteri: ürün fiyatı / nakliye / toplam maliyet ayrı gösterilir (madde 16). */
  @Get('book/:productCode')
  book(
    @Req() req: Request & { user: AuthUser },
    @Param('productCode') productCode: string,
    @Query('city') city?: string,
  ) {
    return this.orders.book(req.user.sub, productCode.toUpperCase(), city);
  }

  @Get('orders')
  listOrders(@Req() req: Request & { user: AuthUser }, @Query('all') all?: string) {
    return this.orders.list(req.user.sub, all === 'true');
  }

  /** Emir verir. Eşleşme tur motorunun P2 fazında yapılır. */
  @Post('orders')
  @UseInterceptors(IdempotencyInterceptor)
  placeOrder(
    @Req() req: Request & { user: AuthUser },
    @Body(new ZodPipe(placeOrderSchema)) dto: PlaceOrderDto,
  ) {
    return this.orders.place(req.user.sub, dto);
  }

  @Delete('orders/:id')
  cancelOrder(@Req() req: Request & { user: AuthUser }, @Param('id') id: string) {
    return this.orders.cancel(req.user.sub, id);
  }

  /** Yoldaki mal — hiçbir envanterde değildir (A3). */
  @Get('shipments')
  shipments(@Req() req: Request & { user: AuthUser }) {
    return this.orders.shipments(req.user.sub);
  }

  @Get(':cityCode')
  offers(@Param('cityCode') cityCode: string, @Query('product') product?: string) {
    return this.market.offers(cityCode, product);
  }

  @Post('buy')
  @UseInterceptors(IdempotencyInterceptor)
  buy(@Req() req: Request & { user: AuthUser }, @Body(new ZodPipe(buySchema)) dto: BuyDto) {
    return this.market.buy(req.user.sub, dto);
  }
}
