#!/usr/bin/env tsx
import { createSql } from '../client.js';
import { loadRootEnv } from '../env.js';
import { seedNpcWorld } from '../seed/npc-world.js';

loadRootEnv();

const sql = createSql({ max: 1, statementTimeoutMs: 120_000 });
console.log('NPC dunyasi kuruluyor...');
seedNpcWorld(sql).then(
  async (r) => {
    console.log(`  ${r.companies} yeni NPC · ${r.facilities} tesis · ${r.profiles} profil`);
    await sql.end({ timeout: 5 });
    process.exit(0);
  },
  async (e) => { console.error('HATA:', e.message); await sql.end({ timeout: 5 }); process.exit(1); },
);
