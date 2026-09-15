import { Yakinda } from '~/ui/parcalar';
export default function Piyasa() {
  return <Yakinda ikon="chart-line-variant" baslik="Piyasa" maddeler={[
    'Emir defteri: ürün fiyatı · nakliye · TOPLAM maliyet ayrı (madde 16)',
    'Alış ve satış emri verme',
    'Açık emirler ve yoldaki sevkiyatlar',
  ]} />;
}
