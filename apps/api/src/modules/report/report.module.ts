import { Module } from '@nestjs/common';
import { ReportController } from './report.controller.js';
import { ReportService } from './report.service.js';

@Module({ controllers: [ReportController], providers: [ReportService] })
export class ReportModule {}
