import { Module } from '@nestjs/common';
import { WorldController } from './world.controller.js';

@Module({ controllers: [WorldController] })
export class WorldModule {}
