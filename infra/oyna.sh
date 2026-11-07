#!/usr/bin/env bash
#
# Oyun sunucusunu ayağa kaldırır: API + tur işçisi + Cloudflare tüneli.
#
# ★★★★ BU BETİK NEDEN VAR. TestFlight'taki uygulama sunucuyu bu makinede
# arıyor; sunucu üç ayrı süreçten oluşuyor ve hepsi elle başlatılıyordu.
# Makine yeniden başladığında (ya da terminal kapandığında) üçü de ölüyor,
# oyuncunun elindeki uygulama "bağlanamadı" diyor ve kimse hangi komutların
# hangi ortam değişkenleriyle çalıştığını hatırlamıyordu. Tek komut:
#
#     infra/oyna.sh          # başlat (veya yeniden başlat)
#     infra/oyna.sh dur      # durdur
#     infra/oyna.sh durum    # ne çalışıyor
#
# ★ ADRES YAYINLANIR. Ücretsiz Cloudflare tünelinin adresi her başlatmada
# DEĞİŞİR; uygulamaya gömülü adres bir kez öldükten sonra geri gelmiyor.
# Betik yeni adresi deponun `sunucu` dalındaki `sunucu.json`a yazar,
# uygulama açılışta oradan okur (bkz. apps/mobile/src/api/sunucu.ts).
# Böylece tünel adresi değiştiğinde YENİ YAPI GEREKMEZ.
set -euo pipefail

KOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IS_DIZIN="/tmp/kapital-oyna"
VERITABANI="${KAPITAL_DB:-kapital_deneme}"
KAPI="${KAPITAL_PORT:-3999}"
DEPO="enesdedeoglu/Kapital"
DAL="sunucu"

mkdir -p "$IS_DIZIN"

pid_oku() { [ -f "$IS_DIZIN/$1.pid" ] && cat "$IS_DIZIN/$1.pid" || echo ""; }
yasiyor() { local p; p="$(pid_oku "$1")"; [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }

durdur() {
  for ad in tunel isci api; do
    local p; p="$(pid_oku "$ad")"
    if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then
      # Süreç grubu öldürülür: pnpm → tsx → node zinciri tek sinyalle gitmez.
      kill -TERM -- "-$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null || true
      echo "durduruldu: $ad ($p)"
    fi
    rm -f "$IS_DIZIN/$ad.pid"
  done
}

durum() {
  for ad in api isci tunel; do
    if yasiyor "$ad"; then echo "✓ $ad çalışıyor ($(pid_oku "$ad"))"
    else echo "✗ $ad kapalı"; fi
  done
  [ -f "$IS_DIZIN/adres.txt" ] && echo "adres: $(cat "$IS_DIZIN/adres.txt")"
  curl -fsS -m 5 "http://127.0.0.1:$KAPI/health" >/dev/null 2>&1 \
    && echo "✓ API yanıt veriyor (http://127.0.0.1:$KAPI)" \
    || echo "✗ API yanıt vermiyor"
}

case "${1:-basla}" in
  dur) durdur; exit 0 ;;
  durum) durum; exit 0 ;;
  basla) ;;
  *) echo "kullanım: $0 [basla|dur|durum]" >&2; exit 2 ;;
esac

# ── 1. Önkoşullar ────────────────────────────────────────────────────────────
pg_isready -q -h localhost -p 5432 || {
  echo "Postgres kapalı. Başlat: brew services start postgresql@16" >&2; exit 1; }
psql -lqtA postgres | cut -d'|' -f1 | grep -qx "$VERITABANI" || {
  echo "Veritabanı yok: $VERITABANI" >&2
  echo "Kur: createdb $VERITABANI && DATABASE_URL=postgres://\$USER@localhost:5432/$VERITABANI pnpm db:migrate && … db:seed" >&2
  exit 1; }
command -v cloudflared >/dev/null || { echo "cloudflared kurulu değil" >&2; exit 1; }

durdur  # eski koşumdan artan süreç kalmasın

# ── 1b. Çalışma alanı paketleri derlenir ─────────────────────────────────────
# ★★★★ API VE İŞÇİ `dist/` OKUR, `src/` DEĞİL. `@kapital/engine` gibi paketler
# derlenmiş çıktıdan yükleniyor; tsx yalnız apps/* kaynağını izliyor. Derlemeyi
# atlayınca oyun ESKİ ekonomi koduyla koşar ve bu hiçbir yerde görünmez —
# ölçüldü: motor kaynağına eklenen bir değişiklik canlı turda hiç çalışmadı,
# turlar eski dist ile koştu.
echo "Paketler derleniyor…"
( cd "$KOK" && pnpm build ) >"$IS_DIZIN/derleme.log" 2>&1 || {
  echo "Derleme başarısız — $IS_DIZIN/derleme.log" >&2
  tail -20 "$IS_DIZIN/derleme.log" >&2
  exit 1; }
echo "✓ Paketler güncel"

export DATABASE_URL="postgres://$USER@localhost:5432/$VERITABANI"
export PORT="$KAPI"

# ── 2. API ───────────────────────────────────────────────────────────────────
# `setsid` yok (macOS); süreç grubu `set -m` ile ayrılır, durdurma onu kullanır.
set -m
( cd "$KOK" && exec pnpm --filter @kapital/api dev ) >"$IS_DIZIN/api.log" 2>&1 &
echo $! > "$IS_DIZIN/api.pid"
set +m

printf 'API bekleniyor'
for _ in $(seq 1 60); do
  if curl -fsS -m 2 "http://127.0.0.1:$KAPI/health" >/dev/null 2>&1; then break; fi
  printf '.'; sleep 1
done
echo
curl -fsS -m 3 "http://127.0.0.1:$KAPI/health" >/dev/null || {
  echo "API açılmadı — $IS_DIZIN/api.log" >&2; tail -20 "$IS_DIZIN/api.log" >&2; exit 1; }
echo "✓ API hazır (kapı $KAPI, veritabanı $VERITABANI)"

# ── 3. Tur işçisi ────────────────────────────────────────────────────────────
# ★ Makine gece kapanıyor; sabah binlerce tur birikmiş oluyor. Varsayılan
# politika operatör onayı bekler ve dünya DONAR (oyuncu için "uygulama bozuk").
# Burada boşluk yok sayılır: kapalı geçen süre oynanmamış sayılır.
export KAPITAL_TUR_BOSLUGU=atla
set -m
( cd "$KOK" && exec pnpm --filter @kapital/worker dev ) >"$IS_DIZIN/isci.log" 2>&1 &
echo $! > "$IS_DIZIN/isci.pid"
set +m
echo "✓ Tur işçisi başladı (15 dakikada bir tur)"

# ── 4. Tünel ─────────────────────────────────────────────────────────────────
: > "$IS_DIZIN/tunel.log"
set -m
( exec cloudflared tunnel --no-autoupdate --url "http://localhost:$KAPI" ) \
  >"$IS_DIZIN/tunel.log" 2>&1 &
echo $! > "$IS_DIZIN/tunel.pid"
set +m

printf 'Tünel adresi bekleniyor'
ADRES=""
for _ in $(seq 1 60); do
  ADRES="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$IS_DIZIN/tunel.log" | head -1 || true)"
  [ -n "$ADRES" ] && break
  printf '.'; sleep 1
done
echo
[ -n "$ADRES" ] || { echo "Tünel adresi alınamadı — $IS_DIZIN/tunel.log" >&2; exit 1; }
echo "$ADRES" > "$IS_DIZIN/adres.txt"
echo "✓ Tünel: $ADRES"

# ── 5. Adresi yayınla ────────────────────────────────────────────────────────
# Uygulama bu dosyayı açılışta okur; yazılamazsa oyun yine çalışır ama
# oyuncunun adresi elle girmesi gerekir — bu yüzden hata ölümcül değil.
#
# ★ YAYIN GIT NESNELERİYLE YAPILIR, çalışma kopyasına dokunulmadan: dal her
# seferinde TEK commit'lik (ebeveynsiz) yeniden yazılır, böylece tünel her
# yeniden başladığında depo geçmişi şişmez. `sunucu` dalı CI tetiklemez —
# ci.yml yalnız main'i dinliyor.
YAYIN_JSON="$(printf '{\n  "api": "%s",\n  "guncellendi": "%s"\n}\n' \
  "$ADRES" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")"
if BLOB="$(printf '%s' "$YAYIN_JSON" | git -C "$KOK" hash-object -w --stdin 2>/dev/null)" \
  && TREE="$(printf '100644 blob %s\tsunucu.json\n' "$BLOB" | git -C "$KOK" mktree 2>/dev/null)" \
  && COMMIT="$(git -C "$KOK" commit-tree "$TREE" -m "Sunucu adresi: $ADRES" 2>/dev/null)" \
  && git -C "$KOK" push -q --force origin "$COMMIT:refs/heads/$DAL" 2>/dev/null; then
  echo "✓ Adres yayınlandı ($DAL dalı) — uygulama yeni yapı olmadan bulur"
else
  echo "⚠ Adres yayınlanamadı (depoya yazma izni?)." >&2
  echo "  Uygulamada Sunucu panelinden elle gir: $ADRES" >&2
fi

echo
echo "Günlükler: $IS_DIZIN/{api,isci,tunel}.log"
echo "Durdurmak için: infra/oyna.sh dur"
