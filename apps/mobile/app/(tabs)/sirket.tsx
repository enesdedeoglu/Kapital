import { Yakinda } from '~/ui/parcalar';
export default function Sirketim() {
  return <Yakinda ikon="factory" baslik="Şirketim" maddeler={[
    'Tesis kartları: üretim durumu, kapasite, seviye',
    'Fiyat belirleme',
    'Stok: toplam · ortalama kalite · ağırlıklı ortalama maliyet',
    'Lot detayı (alttan açılır panel)',
  ]} />;
}
