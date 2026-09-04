/**
 * Oyuncu eylemleri — dışarıya açılan servis yüzeyi.
 *
 * `apps/sim` bu servisleri DOĞRUDAN örnekler. Amaç, simüle edilen oyuncunun
 * gerçek oyuncuyla aynı kod yolundan geçmesidir: aynı doğrulamalar, aynı
 * seviye kilitleri, aynı nakit kontrolleri, aynı defter kayıtları.
 *
 * Kuralları simülasyon için ikinci kez yazmak, simülasyonu ölçtüğü şeyden
 * ayırırdı — denge kapısı da o kadar anlamsızlaşırdı.
 *
 * Hepsi tek parametreli düz sınıftır (`constructor(@Inject(SQL) sql)`), bu
 * yüzden Nest konteyneri olmadan `new Service(sql)` ile kurulabilirler.
 */
export { CompanyService } from './modules/company/company.service.js';
export { FacilityService } from './modules/facility/facility.service.js';
export { InventoryService } from './modules/inventory/inventory.service.js';
export { LoanService } from './modules/loan/loan.service.js';
export { OrderService } from './modules/market/order.service.js';
export { MarketService } from './modules/market/market.service.js';
export { RetailService } from './modules/retail/retail.service.js';
export { StandingService } from './modules/standing/standing.service.js';
