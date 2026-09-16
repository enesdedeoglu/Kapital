/**
 * Tesisin ayırt edici adı — "Manav · İstanbul".
 *
 * ★ ŞEHİR SÜS DEĞİL, TEK AYIRT EDİCİ. Tesise isim verilemiyor (`TesisPaneli`de
 * isim alanı yok, sunucu da `dto.name ?? type.name` ile tipin adını koyuyor),
 * yani iki manavı olan oyuncunun ekranında iki tane "Manav" var ve hangisinin
 * hangisi olduğu yazmıyor. Emir panelindeki teslim tesisi seçicisinde bu
 * doğrudan yanlış karara yol açıyordu: oyuncu malı hangi şehre getirttiğini
 * göremiyor.
 */
export function tesisEtiketi(t: { name: string; city: { name: string } }): string {
  return `${t.name} · ${t.city.name}`;
}
