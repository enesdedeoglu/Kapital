#!/usr/bin/env tsx
/**
 * Operatör parola sıfırlama — "parolamı unuttum"un şimdilik tek yolu.
 *
 * ★★★★ KENDİ KENDİNE SIFIRLAMA YOK, ÇÜNKÜ E-POSTA YOK. Gerçek "parolamı
 * unuttum" akışı, parolayı bilmeyen birine bağlantı göndermeyi gerektirir;
 * gönderecek bir kanal (SMTP ya da bir e-posta sağlayıcısı) olmadan aynı
 * akışı uygulamanın içine koymak, e-postasını bilen herkesin hesabı ele
 * geçirmesi demek olurdu. Bu yüzden sıfırlama SUNUCUYA ERİŞEBİLEN KİŞİDE:
 * kapalı testte oyuncuyu tanıyan zaten odur.
 *
 * Kullanım:
 *   pnpm --filter @kapital/api parola oyuncu@ornek.com
 *   pnpm --filter @kapital/api parola oyuncu@ornek.com "elle-verilen-parola"
 *
 * ★ Parola BİR KEZ yazılır ekrana ve hiçbir yere kaydedilmez; özeti
 * `users.password_hash`e gider. Verilmezse güçlü bir parola üretilir.
 * ★ Bütün oturumlar kapatılır: eski yenileme jetonu 30 gün geçerli kalırdı,
 * yani parolayı sıfırlamak eski erişimi kesmezdi.
 */
import { randomBytes } from 'node:crypto';
import { createSql, loadRootEnv } from '@kapital/db';
import { hashPassword } from '../modules/auth/password.js';

loadRootEnv();

const [email, verilen] = process.argv.slice(2);
if (!email) {
  console.error('Kullanım: pnpm --filter @kapital/api parola <e-posta> [yeni-parola]');
  process.exit(2);
}
if (verilen !== undefined && verilen.length < 8) {
  console.error('Parola en az 8 karakter olmalı.');
  process.exit(2);
}

const sql = createSql();
try {
  const [user] = await sql<{ id: string; display_name: string }[]>`
    SELECT id, display_name FROM users WHERE email = ${email}`;
  if (!user) {
    console.error(`Böyle bir hesap yok: ${email}`);
    process.exit(1);
  }

  // base64url: kopyalanırken bozulacak karakter yok (oyuncuya mesajla gidecek).
  const parola = verilen ?? randomBytes(9).toString('base64url');
  const hash = await hashPassword(parola);

  const iptal = await sql.begin(async (tx) => {
    await tx`UPDATE users SET password_hash = ${hash} WHERE id = ${user.id}::uuid`;
    const rows = await tx`
      UPDATE refresh_tokens SET revoked_at = NOW()
       WHERE user_id = ${user.id}::uuid AND revoked_at IS NULL
       RETURNING id`;
    return rows.length;
  });

  console.log(`\n  ${user.display_name} <${email}>`);
  console.log(`  yeni parola: ${parola}`);
  console.log(`  kapatılan oturum: ${iptal}`);
  console.log('\n  Bu parola bir daha gösterilmeyecek. Oyuncuya ilet, girdikten');
  console.log('  sonra Profil > Parolayı değiştir ile kendi parolasını koysun.\n');
} finally {
  await sql.end();
}
