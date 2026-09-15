import { Yerdurak } from '~/ui/Yerdurak';
export default function Sehirler() {
  return <Yerdurak baslik="Şehirler" maddeler={[
    'Şehir listesi ve mesafeler',
    'Şehir bazlı talep ve fiyat farkları',
  ]} />;
}
