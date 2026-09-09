import { Inject, Injectable } from '@nestjs/common';
import { CONFIG_KEYS, getConfig, loadConfigSnapshot, type StartConfig } from '@kapital/config';
import { currentTickSeq, runInTransaction, transfer, type Sql } from '@kapital/db';
import {
  asMoney, Conflict, deterministicUuid, DomainError, formatMoney, NotFound,
} from '@kapital/shared';
import { SQL } from '../../common/db.module.js';
import type { CreateCompanyDto } from './company.dto.js';

export interface CompanyView {
  id: string;
  name: string;
  cash: string;
  cashFormatted: string;
  usdBalance: string;
  companyValue: string;
  level: number;
  levelTitle: string;
  experience: string;
  reputation: string;
  city: { id: number; code: string; name: string };
  status: string;
  createdAt: string;
}

@Injectable()
export class CompanyService {
  constructor(@Inject(SQL) private readonly sql: Sql) {}

  async create(userId: string, dto: CreateCompanyDto): Promise<CompanyView> {
    const [existing] = await this.sql`SELECT 1 FROM companies WHERE user_id = ${userId}::uuid`;
    if (existing) throw new Conflict('Bu hesabın zaten bir şirketi var');

    const [city] = await this.sql<{ id: number }[]>`
      SELECT id FROM cities WHERE code = ${dto.cityCode} AND is_active`;
    if (!city) throw new NotFound('Şehir', dto.cityCode);

    // Başlangıç sermayesi config'ten gelir — koda gömülü değil (madde 58.7).
    const snapshot = await loadConfigSnapshot(this.sql, 0n);
    const start = getConfig<StartConfig>(snapshot, CONFIG_KEYS.start);
    if (!start.facilityChoices.includes(dto.facilityTypeCode)) {
      throw new DomainError('VALIDATION', 'Bu işletme türü başlangıçta seçilemez', {
        allowed: start.facilityChoices,
      });
    }
    const startingCash = asMoney(BigInt(start.cash));

    const companyId = await runInTransaction(this.sql, async (tx) => {
      // ★ Kimlik deterministik (R79): bir kullanıcının bir şirketi var.
      const [company] = await tx<{ id: string }[]>`
        INSERT INTO companies (id, user_id, kind, name, home_city_id, cash)
        VALUES (${deterministicUuid('company', userId)}::uuid,
                ${userId}::uuid, 'PLAYER', ${dto.name}, ${city.id}, 0)
        RETURNING id`;
      await tx`INSERT INTO company_stats (company_id) VALUES (${company!.id}::uuid)`;

      const [treasury] = await tx<{ id: string }[]>`
        SELECT id FROM companies WHERE system_code = 'SYS_TREASURY'`;

      // Başlangıç sermayesi de deftere yazılır: para arzı her kuruşu izlenebilir (I1).
      const tickSeq = await currentTickSeq(tx);
      await transfer(tx, {
        tickId: tickSeq,
        fromCompanyId: treasury!.id,
        toCompanyId: company!.id,
        amount: startingCash,
        account: 'SEED',
        reason: 'şirket kuruluş sermayesi',
        refType: 'company',
        refId: company!.id,
      });

      /*
       * ★ İLK TESİS ŞİRKETLE BİRLİKTE KURULUR — madde 4: "İlk tesis:
       * Manav | Büfe (seçmeli)".
       *
       * `facilityTypeCode` doğrulanıp ATILIYORDU: oyuncu seçimini yapıyor,
       * kural kontrol ediliyor, sonra hiçbir şey olmuyordu. Şirket tesissiz
       * kuruluyor ve oyuncu ayrıca bir tesis kurmak zorunda kalıyordu.
       *
       * Kurulum maliyeti ALINMAZ: bu tesis başlangıç sermayesinin bir parçası,
       * satın alınan bir yatırım değil (madde 4'te nakit 30.000 ₺ VE ilk tesis
       * birlikte veriliyor).
       */
      const [type] = await tx<{ id: number; name: string; storage_capacity: bigint }[]>`
        SELECT id, name, storage_capacity FROM facility_types
         WHERE code = ${dto.facilityTypeCode} AND is_active`;
      if (!type) throw new NotFound('Tesis türü', dto.facilityTypeCode);

      await tx`
        INSERT INTO facilities (id, company_id, facility_type_id, city_id, name,
                                storage_capacity, construction_complete_at_tick)
        VALUES (${deterministicUuid('facility', company!.id, 'baslangic')}::uuid,
                ${company!.id}::uuid, ${type.id}, ${city.id}, ${type.name},
                ${type.storage_capacity}, ${tickSeq})`;
      await tx`UPDATE company_stats SET facilities_built = 1
                WHERE company_id = ${company!.id}::uuid`;

      return company!.id;
    });

    return this.getById(companyId);
  }

  async getByUser(userId: string): Promise<CompanyView> {
    const [row] = await this.sql<{ id: string }[]>`
      SELECT id FROM companies WHERE user_id = ${userId}::uuid`;
    if (!row) throw new NotFound('Şirket');
    return this.getById(row.id);
  }

  async getById(companyId: string): Promise<CompanyView> {
    const [row] = await this.sql<Record<string, never>[]>`
      SELECT c.id, c.name, c.cash, c.usd_balance, c.company_value, c.level,
             c.experience, c.reputation, c.status, c.created_at,
             ct.id AS city_id, ct.code AS city_code, ct.name AS city_name,
             COALESCE(cl.title, 'Esnaf') AS level_title
      FROM companies c
      JOIN cities ct ON ct.id = c.home_city_id
      LEFT JOIN company_levels cl ON cl.level = c.level
      WHERE c.id = ${companyId}::uuid`;
    if (!row) throw new NotFound('Şirket', companyId);

    const r = row as unknown as {
      id: string; name: string; cash: bigint; usd_balance: bigint; company_value: bigint;
      level: number; experience: bigint; reputation: string; status: string;
      created_at: string | Date;
      city_id: number; city_code: string; city_name: string; level_title: string;
    };
    const cash = asMoney(r.cash);
    return {
      id: r.id,
      name: r.name,
      cash: cash.toString(),
      cashFormatted: formatMoney(cash),
      usdBalance: r.usd_balance.toString(),
      companyValue: r.company_value.toString(),
      level: r.level,
      levelTitle: r.level_title,
      experience: r.experience.toString(),
      reputation: r.reputation,
      city: { id: r.city_id, code: r.city_code, name: r.city_name },
      status: r.status,
      createdAt: new Date(r.created_at).toISOString(),
    };
  }
}
