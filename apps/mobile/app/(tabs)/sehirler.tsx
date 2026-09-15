import { Yakinda } from '~/ui/parcalar';
export default function Sehirler() {
  return <Yakinda ikon="map-marker-radius" baslik="Şehirler" maddeler={[
    'Şehir listesi ve aralarındaki mesafeler',
    'Şehir bazlı talep ve fiyat farkları',
  ]} />;
}
