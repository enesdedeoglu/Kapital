import { Module } from '@nestjs/common';
import { FacilityController } from './facility.controller.js';
import { FacilityService } from './facility.service.js';

@Module({ controllers: [FacilityController], providers: [FacilityService], exports: [FacilityService] })
export class FacilityModule {}
