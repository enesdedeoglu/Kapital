import { describe, expect, it, vi } from 'vitest';
import { tekUcus } from './tekUcus';

describe('tekUcus — paralel çağrılar tek işe iner', () => {
  it('aynı anda gelen çağrılar işi BİR KEZ çalıştırır', async () => {
    const calis = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return 'jeton-1';
    });
    const kap = tekUcus<string>();

    const sonuclar = await Promise.all([kap(calis), kap(calis), kap(calis)]);

    expect(calis).toHaveBeenCalledTimes(1);
    expect(sonuclar).toEqual(['jeton-1', 'jeton-1', 'jeton-1']);
  });

  it('uçuş bitince YENİ çağrı yeni iş başlatır', async () => {
    let sayac = 0;
    const calis = vi.fn(async () => `jeton-${++sayac}`);
    const kap = tekUcus<string>();

    expect(await kap(calis)).toBe('jeton-1');
    expect(await kap(calis)).toBe('jeton-2');
    expect(calis).toHaveBeenCalledTimes(2);
  });

  it('★ hata da PAYLAŞILIR — herkes aynı hatayı alır, iş tekrarlanmaz', async () => {
    const calis = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      throw new Error('geçersiz oturum');
    });
    const kap = tekUcus<string>();

    const sonuclar = await Promise.allSettled([kap(calis), kap(calis)]);

    expect(calis).toHaveBeenCalledTimes(1);
    expect(sonuclar.every((s) => s.status === 'rejected')).toBe(true);
  });

  it('★ hatadan SONRA yeniden denenebilir — uçuş kilitli kalmaz', async () => {
    let ilk = true;
    const calis = vi.fn(async () => {
      if (ilk) { ilk = false; throw new Error('geçici'); }
      return 'jeton-2';
    });
    const kap = tekUcus<string>();

    await expect(kap(calis)).rejects.toThrow('geçici');
    // Başarısız uçuş temizlenmezse burası sonsuza dek aynı hatayı verirdi.
    expect(await kap(calis)).toBe('jeton-2');
  });
});
