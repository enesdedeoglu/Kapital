import { Yerdurak } from '~/ui/Yerdurak';
export default function Sirketim() {
  return <Yerdurak baslik="Şirketim" maddeler={[
    'Tesis kartları: üretim durumu, kapasite, seviye',
    'Fiyat belirleme',
    'Stok: toplam / ortalama kalite / ağırlıklı ortalama maliyet',
    'Lot detayı (alttan açılır panel)',
  ]} />;
}
