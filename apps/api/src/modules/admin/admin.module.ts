import { Module } from '@nestjs/common';
import { AdminController, AdminGuard } from './admin.controller.js';

@Module({ controllers: [AdminController], providers: [AdminGuard] })
export class AdminModule {}
