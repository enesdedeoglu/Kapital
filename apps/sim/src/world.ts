/**
 * Simülasyon dünyası — oyuncu nüfusunun kurulması.
 *
 * Şirketler GERÇEK yoldan kurulur (`CompanyService.create`): başlangıç
 * sermayesi config'ten gelir, deftere yazılır, onboarding tesisi seçilir.
 * Simülasyon kısayol kullanmaz; ölçtüğü ekonominin kurallarına tabidir.
 */
import { CompanyService, FacilityService } from '@kapital/api/services';
import type { Sql } from '@kapital/db';
import { mulberry32 } from '@kapital/shared';
import { allocatePopulation, PLAYER_PROFILES, type PlayerProfile } from './profiles.js';

export interface SimPlayer {
  readonly userId: string;
  readonly companyId: string;
  readonly index: number;
  readonly profile: PlayerProfile;
  readonly cityCode: string;
  /** Kararlarında kullanacağı tohumlu RNG — koşular tekrarlanabilir olsun. */
  readonly rng: () => number;
}

const FIRST_NAMES = [
  'Ada', 'Bora', 'Ceren', 'Deniz', 'Ege', 'Ferda', 'Gökay', 'Hale',
  'Irmak', 'Kerem', 'Lale', 'Mert', 'Nehir', 'Oya', 'Poyraz', 'Rüya',
];
const SUFFIXES = ['Ticaret', 'Gıda', 'Holding', 'Lojistik', 'Sanayi', 'Market', 'Grup', 'Yatırım'];

export async function buildSimWorld(
  sql: Sql, opts: { players: number; seed: number },
): Promise<SimPlayer[]> {
  const companies = new CompanyService(sql);
  const facilities = new FacilityService(sql);

  const cities = await sql<{ code: string }[]>`
    SELECT code FROM cities WHERE is_active ORDER BY id`;
  if (cities.length === 0) throw new Error('şehir yok — önce tohumlama gerekir');

  const counts = allocatePopulation(opts.players);
  const queue: PlayerProfile[] = [];
  for (const profile of PLAYER_PROFILES) {
    for (let i = 0; i < (counts.get(profile.code) ?? 0); i++) queue.push(profile);
  }
  // Profilleri karıştır: aynı profildekiler ardışık şehirlere düşmesin.
  const shuffleRng = mulberry32(opts.seed);
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(shuffleRng() * (i + 1));
    [queue[i], queue[j]] = [queue[j]!, queue[i]!];
  }

  const players: SimPlayer[] = [];
  for (let index = 0; index < queue.length; index++) {
    const profile = queue[index]!;
    const rng = mulberry32(opts.seed + index * 7919);
    const cityCode = cities[index % cities.length]!.code;
    const name = `${FIRST_NAMES[index % FIRST_NAMES.length]} ${SUFFIXES[(index / FIRST_NAMES.length | 0) % SUFFIXES.length]} ${index}`;

    const [user] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, display_name)
      VALUES (${`sim-${opts.seed}-${index}@kapital.sim`}, 'x', ${name})
      ON CONFLICT (email) DO NOTHING
      RETURNING id`;
    if (!user) continue; // aynı tohumla ikinci kez kurulmuş

    // Onboarding: pasif ve ucuzcu büfeyle, diğerleri manavla başlar (madde 4).
    const starter = profile.code === 'PASSIVE' || profile.code === 'DISCOUNTER'
      ? 'KIOSK' : 'GREENGROCER';
    const company = await companies.create(user.id, {
      name, cityCode, facilityTypeCode: starter,
    });

    players.push({
      userId: user.id, companyId: company.id, index, profile, cityCode, rng,
    });
    void facilities;
  }
  return players;
}
