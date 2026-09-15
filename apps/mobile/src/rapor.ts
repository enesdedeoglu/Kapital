import * as SecureStore from 'expo-secure-store';

const ANAHTAR = 'kapital.sonGorulenTur';

/**
 * "En son hangi turu gördüm" işareti — madde 45 raporunun penceresi.
 *
 * ★ İŞARET İSTEMCİDE. Sunucuda tutmak `GET /report`i yan etkili yapardı:
 * çağıran her istek işareti ileri atar, rapor bir daha okunamazdı. Üstelik
 * "ne zaman rapor göstereyim" bir oyun gerçeği değil, sunum kararıdır.
 *
 * ★ SecureStore SIR OLDUĞU İÇİN DEĞİL, ZATEN KURULU OLDUĞU İÇİN kullanılıyor:
 * tek bir tamsayı uğruna AsyncStorage bağımlılığı eklemeye değmez.
 */
export async function sonGorulenTur(): Promise<bigint | null> {
  try {
    const ham = await SecureStore.getItemAsync(ANAHTAR);
    return ham !== null && /^\d+$/.test(ham) ? BigInt(ham) : null;
  } catch {
    // Depo okunamıyorsa rapor penceresi bilinmiyordur; sunucu en geniş
    // pencereyi uygular. Oyuncuyu bir depo hatası yüzünden durdurmayız.
    return null;
  }
}

export async function sonGorulenTuruYaz(tur: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(ANAHTAR, tur);
  } catch { /* yazılamazsa rapor bir kez daha görünür — zararsız */ }
}

export async function sonGorulenTuruSil(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(ANAHTAR);
  } catch { /* yok sayılır */ }
}
