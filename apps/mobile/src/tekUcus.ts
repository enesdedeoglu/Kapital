/**
 * Tek uçuş (single-flight): aynı anda giden birden çok çağrıyı TEK işe indirir.
 *
 * ★ NEDEN GEREKLİ: API yenileme jetonunu ROTASYONLA kullanır — kullanılan
 * jeton iptal edilir, yenisi verilir. Ekranlar isteklerini paralel attığı için
 * (ana sayfa `/company` + `/dashboard`, Şirketim `/facilities` + tesis başına
 * `/stock`) erişim jetonu dolduğunda hepsi birden yenilemeye kalkıyordu: biri
 * jetonu tüketiyor, ötekiler "geçerli oturum yok" alıyor ve oyuncu DIŞARI
 * ATILIYORDU.
 *
 * Burada ayrı bir birim olmasının sebebi: bu garanti sessizce bozulabilir ve
 * bozulduğunda belirtisi "bazen oturum düşüyor" olur — test edilebilir olmalı.
 */
export function tekUcus<T>(): (is: () => Promise<T>) => Promise<T> {
  let ucus: Promise<T> | null = null;
  return (is) => {
    // Uçuş varsa ona katıl; yoksa başlat. Bitince (başarı ya da hata) temizle.
    ucus ??= is().finally(() => { ucus = null; });
    return ucus;
  };
}
