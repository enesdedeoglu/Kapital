/** API'nin döndürdüğü biçimler. Para alanları STRING gelir (ADR-0001: bigint). */

export interface Sehir {
  readonly id: number;
  readonly code: string;
  readonly name: string;
}

export interface Sirket {
  readonly id: string;
  readonly name: string;
  /** Kuruş cinsinden bigint, string olarak taşınır. */
  readonly cash: string;
  readonly cashFormatted: string;
  readonly usdBalance: string;
  readonly companyValue: string;
  readonly level: number;
  readonly levelTitle: string;
  readonly experience: string;
  readonly reputation: string;
  readonly city: Sehir;
  readonly status: string;
  readonly createdAt: string;
}

export interface OturumYaniti {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn?: number;
}
