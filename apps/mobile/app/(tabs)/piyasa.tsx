import { Yerdurak } from '~/ui/Yerdurak';
export default function Piyasa() {
  return <Yerdurak baslik="Piyasa" maddeler={[
    'Emir defteri: ürün fiyatı / nakliye / TOPLAM maliyet ayrı (madde 16)',
    'Alış-satış emri verme',
    'Açık emirler ve yoldaki sevkiyatlar',
  ]} />;
}
