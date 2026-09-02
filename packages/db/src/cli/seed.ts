#!/usr/bin/env tsx
import { loadRootEnv } from '../env.js';
import { seedFromEnv } from '../seed/index.js';

loadRootEnv();

console.log('Seed calistiriliyor...');
seedFromEnv().then(
  () => { console.log('Seed tamam.'); process.exit(0); },
  (e) => { console.error('HATA:', e.message); process.exit(1); },
);
