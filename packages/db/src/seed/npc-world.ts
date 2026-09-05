import { ARCHETYPES, varyTemplate, type NpcArchetype } from '@kapital/economy';
import { asMoney, money, mulberry32, mulMoney } from '@kapital/shared';
import type { Sql } from '../client.js';
import { transfer } from '../finance/transfer.js';

/**
 * NPC dünyası — docs/08.
 *
 * Hedef NPC sayısı ürün ve şehir sayısından türer: `ürün × şehir × 1,2`.
 * MVP-1'de 10 ürün × 5 şehir × 1,2 = 60. 250 NPC 40 ürünlük ekonomi içindir;
 * 50 pazarda 60 NPC ile her pazarda ortalama 3 satıcı olur — fiyat oluşumu
 * anlamlı, tur süresi bütçe içinde, denge ayarı gözlemlenebilir kalır.
 */
interface NpcPlan {
  readonly archetype: NpcArchetype;
  readonly count: number;
  readonly cities: readonly string[];
  /** [tesis kodu, üretilecek ürün kodu | null] */
  readonly facilities: readonly (readonly [string, string | null])[];
  readonly cash: number;
}

/*
 * ★ DÜNYA ÜRETİM AĞIRLIKLI KURULUR, PERAKENDE AĞIRLIKLI DEĞİL.
 *
 * İlk tasarımda tam tersiydi ve F8 simülasyonu bunu ortaya çıkardı: 114
 * perakende noktasına karşı 35 üretim tesisi, tüm dünyada 5 sebze bahçesi.
 * Domates arzı talebin dörtte biriydi ve domates, seviye 1 oyuncunun
 * satabildiği TEK üründür. Sonuç: oyuncuların alış emirlerinin %98'i mal
 * bulamadan süresi doluyordu (787 emrin 16'sı doldu), raflar boş kalıyordu,
 * bakım gideri ciroyu yiyordu ve hiç kimse Lv2'ye çıkamıyordu.
 *
 * Perakendeyi OYUNCULAR doldurur — madde 31'in amacı zaten NPC payının
 * zamanla geri çekilmesi. NPC'nin asıl işi, oyuncunun satacağı malı üretmek.
 *
 * Toplam 60 NPC korunur; ağırlık tarımdan yana kaydırılır.
 */
const PLAN: readonly NpcPlan[] = [
  // Hammadde arzı — tarım bonusu yüksek şehirlerde.
  // VEG_GARDEN listede İKİ KEZ: domates giriş ürünüdür ve arzı bol olmalı.
  /*
   * ★ Ağırlıklar TALEPTEN türetildi (F8). `seed-data.test` zincirin her
   * aşamasının gereksinimini `chainRequirements` ile hesaplar ve tohum
   * dünyasının onu karşıladığını doğrular. Listede bir tesisin birden çok
   * kez geçmesi, o tesisten daha çok kurulması demektir.
   *
   * Dünya eksik değil YANLIŞ DAĞILMIŞTI: fırın 8 gerekirken 2,7 kuruluyordu,
   * tütün tarlası ise 2 gerekirken 6,8. Perakende ürünlerinin arz/talep oranı
   * bu yüzden 0,10–0,43'te sıkışıyordu.
   */
  { archetype: 'AGRI', count: 16, cities: ['KON', 'ANK', 'IZM'], cash: 250_000,
    facilities: [['VEG_GARDEN', 'TOMATO'], ['VEG_GARDEN', 'TOMATO'],
                 ['VEG_GARDEN', 'TOMATO'], ['WHEAT_FIELD', 'WHEAT'],
                 ['TOBACCO_FARM', 'TOBACCO']] },
  // Maden ve ara ürün — sanayi bonusu yüksek şehirlerde
  { archetype: 'INDUSTRIAL', count: 20, cities: ['BRS', 'IST', 'ANK'], cash: 550_000,
    facilities: [['BAKERY', 'BREAD'], ['BAKERY', 'BREAD'], ['BAKERY', 'BREAD'],
                 ['BAKERY', 'BREAD'],
                 ['CIG_FACTORY', 'CIGARETTE'], ['CIG_FACTORY', 'CIGARETTE'],
                 ['MILL', 'FLOUR'], ['MILL', 'FLOUR'],
                 ['COAL_MINE', 'COAL'], ['IRON_MINE', 'IRON'],
                 ['STEEL_MILL', 'STEEL'], ['FURNITURE_FACTORY', 'FURNITURE']] },
  // Perakende zinciri — tüm şehirlerde, paranın oyuna giriş kapısı
  { archetype: 'RETAIL_CHAIN', count: 8, cities: ['IST', 'ANK', 'IZM', 'KON', 'BRS'], cash: 150_000,
    facilities: [['GREENGROCER', null], ['KIOSK', null], ['MARKET', null]] },
  // Tüccarlar — üretmez, alıp satar; likidite ve fiyat oluşumu sağlar
  { archetype: 'DISCOUNTER', count: 5, cities: ['IST', 'ANK', 'IZM', 'BRS'], cash: 200_000,
    facilities: [['MARKET', null]] },
  { archetype: 'VOLUME', count: 5, cities: ['IST', 'IZM', 'BRS', 'KON'], cash: 300_000,
    facilities: [['MARKET', null]] },
  { archetype: 'PREMIUM', count: 4, cities: ['IST', 'IZM'], cash: 250_000,
    facilities: [['MARKET', null]] },
  { archetype: 'SPECULATOR', count: 2, cities: ['IST', 'ANK'], cash: 350_000,
    facilities: [['MARKET', null]] },
];

const FIRST_NAMES = [
  'Anadolu', 'Ege', 'Marmara', 'Toros', 'Fırat', 'Meriç', 'Sakarya', 'Kızılırmak',
  'Yeşilırmak', 'Seyhan', 'Ceyhan', 'Menderes', 'Susurluk', 'Gediz', 'Aras',
];
const SUFFIXES = [
  'Ticaret', 'Sanayi', 'Gıda', 'Tarım', 'Lojistik', 'Holding', 'Grup',
  'İşletmeleri', 'Endüstri', 'Toptan',
];

/** İsimler deterministik üretilir: aynı tohum aynı dünyayı verir. */
function companyName(seed: number, index: number): string {
  const rng = mulberry32(seed * 7919 + index);
  const first = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)]!;
  const suffix = SUFFIXES[Math.floor(rng() * SUFFIXES.length)]!;
  return `${first} ${suffix} ${index + 1}`;
}

/**
 * Planın kuracağı tesis sayısı — tesis tipi bazında BEKLENEN değer.
 *
 * Gerçek sayı tohumlu RNG'ye bağlıdır (çok tesisli arketiplerde ikinci tesis
 * %35 olasılıkla kurulur), bu yüzden beklenen değer kullanılır. Amaç tam sayı
 * bulmak değil, dünyanın TASARIMINI talebe karşı ölçebilmek: `seed-data.test`
 * bunu kullanarak "kapasite kendi talebini karşılıyor mu" sorusunu sorar.
 */
/** Üretici planlarda NPC başına ortalama tesis yuvası. */
const SLOTS_PER_NPC = 1.35;

/**
 * Bir planın tesis yuvaları, sırayla.
 *
 * ★ Tohum ve sayaç AYNI listeyi kullanır. Önce ayrıydılar: sayaç dağılımı
 * oransal varsayıyor, tohum ise `plan.facilities[(index + s) % uzunluk]` ile
 * KÜRESEL bir sayaç üzerinden dağıtıyordu. INDUSTRIAL planı 16'ncı NPC'de
 * başladığı ve listesi 12 uzunluğunda olduğu için `16 % 12 = 4` — liste
 * fırından değil sigara fabrikasından açılıyordu. Sonuç: sayaç 9 fırın
 * varsayarken tohum 5 kuruyor, 4,5 sigara fabrikası varsayarken 8 kuruyordu.
 * Tohum dengesini doğrulayan test böylece bir kurguyu doğruluyordu; ekmek
 * arz/talep oranı 0,23'te kalırken test yeşil kalıyordu.
 */
function planSlots(plan: NpcPlan): readonly (readonly [string, string | null])[] {
  const total = plan.facilities.length === 1
    ? plan.count
    : Math.round(plan.count * SLOTS_PER_NPC);
  const slots: (readonly [string, string | null])[] = [];
  for (let i = 0; i < total; i++) slots.push(plan.facilities[i % plan.facilities.length]!);
  return slots;
}

export function npcFacilityCounts(): Map<string, number> {
  const counts = new Map<string, number>();
  for (const plan of PLAN) {
    for (const [code] of planSlots(plan)) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  return counts;
}

export interface NpcWorldResult {
  companies: number;
  facilities: number;
  profiles: number;
}

/**
 * NPC dünyasını kurar. Tekrar çalıştırılabilir: var olan NPC'lere dokunmaz.
 *
 * NPC'ler GERÇEK şirketlerdir — aynı tablolar, aynı defter, aynı kurallar.
 * Sermayeleri `SYS_TREASURY`'den gelir (kredi değil), tesis kurulumları
 * `SYS_SINK`'e CAPEX olarak yazılır. Ayrıcalıkları yoktur.
 */
export async function seedNpcWorld(sql: Sql, opts: { seed?: number } = {}): Promise<NpcWorldResult> {
  const seed = opts.seed ?? 20260903;

  const cities = new Map(
    (await sql<{ id: number; code: string; land_cost_index: number }[]>`
      SELECT id, code, land_cost_index FROM cities WHERE is_active`)
      .map((c) => [c.code, c]),
  );
  const facilityTypes = new Map(
    (await sql<{ id: number; code: string; base_cost: bigint; storage_capacity: bigint }[]>`
      SELECT id, code, base_cost, storage_capacity FROM facility_types WHERE is_active`)
      .map((f) => [f.code, f]),
  );
  const recipes = new Map(
    (await sql<{ id: number; facility_code: string; product_code: string }[]>`
      SELECT r.id, ft.code AS facility_code, p.code AS product_code
      FROM production_recipes r
      JOIN facility_types ft ON ft.id = r.facility_type_id
      JOIN products p ON p.id = r.output_product_id
      WHERE r.is_active`)
      .map((r) => [`${r.facility_code}:${r.product_code}`, r.id]),
  );
  const [treasury] = await sql<{ id: string }[]>`
    SELECT id FROM companies WHERE system_code = 'SYS_TREASURY'`;
  const [sink] = await sql<{ id: string }[]>`
    SELECT id FROM companies WHERE system_code = 'SYS_SINK'`;

  let created = 0;
  let facilityCount = 0;
  let index = 0;

  for (const plan of PLAN) {
    const template = ARCHETYPES.find((a) => a.archetype === plan.archetype)!;
    // Yuvalar plan başına önceden üretilir ve sırayla tüketilir; artan
    // yuvalar baştaki NPC'lere ikinci tesis olarak düşer.
    const slots = planSlots(plan);
    let slotCursor = 0;

    for (let i = 0; i < plan.count; i++, index++) {
      const rng = mulberry32(seed + index * 104729);
      const name = companyName(seed, index);
      const cityCode = plan.cities[index % plan.cities.length]!;
      const city = cities.get(cityCode)!;

      const [existing] = await sql<{ id: string }[]>`
        SELECT id FROM companies WHERE name = ${name} AND kind = 'NPC'`;
      if (existing) continue;

      const [company] = await sql<{ id: string }[]>`
        INSERT INTO companies (kind, name, home_city_id, cash, level, reputation)
        VALUES ('NPC', ${name}, ${city.id}, 0, 15, ${(45 + rng() * 30).toFixed(2)})
        RETURNING id`;
      await sql`INSERT INTO company_stats (company_id) VALUES (${company!.id}::uuid)
                ON CONFLICT DO NOTHING`;
      created++;

      // Sermaye SYS_TREASURY'den — kredi DEĞİL, R15 metriğini kirletmez
      await sql.begin((tx) => transfer(tx as unknown as Sql, {
        tickId: 0n, fromCompanyId: treasury!.id, toCompanyId: company!.id,
        amount: money(plan.cash), account: 'SEED', reason: 'NPC kuruluş sermayesi',
      }));

      const profile = varyTemplate(template, rng);
      /*
       * ★ Düşünme turu DAĞITILIR: `last_strategy_tick` herkeste 0 olursa
       * NPC'ler aynı turlarda strateji kurar. Aralıklar 48/96/128 olduğu için
       * tur 384'te 96'lık grup (34 NPC) ve 128'lik grup (24 NPC) birlikte
       * ateşledi; 58 NPC aynı listeye bakıp aynı açığı gördü ve 8 tur sonra
       * 51 buğday tarlası birden açıldı. Negatif başlangıç, ilk kararı
       * aralığın içine yayar ve faz sonsuza dek korunur.
       */
      const phase = -Math.floor(rng() * profile.strategyIntervalTicks);
      await sql`
        INSERT INTO npc_profiles (company_id, archetype, risk_tolerance, target_margin,
                                  quality_target, inventory_target_ticks, price_aggressiveness,
                                  investment_aggressiveness, max_debt_ratio, cash_reserve_ratio,
                                  strategy_interval_ticks, last_strategy_tick)
        VALUES (${company!.id}::uuid, ${profile.archetype}, ${profile.riskTolerance},
                ${profile.targetMargin}, ${profile.qualityTarget}, ${profile.inventoryTargetTicks},
                ${profile.priceAggressiveness}, ${profile.investmentAggressiveness},
                ${profile.maxDebtRatio}, ${profile.cashReserveRatio},
                ${profile.strategyIntervalTicks}, ${phase})
        ON CONFLICT (company_id) DO NOTHING`;

      // Her NPC havuzdan bir yuva alır; artan yuvalar ikinci tesis olur.
      const mySlots = 1 + (i < slots.length - plan.count ? 1 : 0);
      for (let s = 0; s < mySlots && slotCursor < slots.length; s++, slotCursor++) {
        const [facilityCode, productCode] = slots[slotCursor]!;
        const type = facilityTypes.get(facilityCode);
        if (!type) continue;

        const cost = mulMoney(asMoney(type.base_cost), city.land_cost_index).value;
        const recipeId = productCode === null ? null : recipes.get(`${facilityCode}:${productCode}`) ?? null;

        const [facility] = await sql<{ id: string }[]>`
          INSERT INTO facilities (company_id, facility_type_id, city_id, name,
                                  storage_capacity, construction_complete_at_tick,
                                  active_recipe_id)
          VALUES (${company!.id}::uuid, ${type.id}, ${city.id},
                  ${`${name} — ${facilityCode}`}, ${type.storage_capacity}, 0, ${recipeId})
          RETURNING id`;
        facilityCount++;

        await sql.begin((tx) => transfer(tx as unknown as Sql, {
          tickId: 0n, fromCompanyId: company!.id, toCompanyId: sink!.id,
          amount: cost, account: 'CAPEX', reason: 'NPC tesis kurulumu',
          refType: 'facility', refId: facility!.id,
        }));
      }
    }
  }

  const profileRows = await sql<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM npc_profiles`;
  return {
    companies: created,
    facilities: facilityCount,
    profiles: Number(profileRows[0]?.count ?? 0n),
  };
}
