/**
 * Daftar kurir yang didukung di checkout dan helper untuk membuka halaman
 * pelacakan resmi kurir tersebut.
 *
 * Catatan: API RajaOngkir paket Starter hanya mendukung jne, pos, dan tiki.
 * J&T (jnt) didukung di paket Pro. Di mode mock kita selalu bisa generate
 * estimasi ongkir untuk semua kurir, tapi ongkir live untuk JNT akan
 * fallback ke mock kalau API gagal.
 */
export type CourierCode = 'jne' | 'jnt' | 'pos' | 'tiki';

export interface CourierInfo {
  code: CourierCode;
  label: string;
  /** Build the public tracking URL for an AWB / nomor resi. */
  trackingUrl: (awb: string) => string;
}

export const COURIERS: Record<CourierCode, CourierInfo> = {
  jne: {
    code: 'jne',
    label: 'JNE',
    trackingUrl: (awb) => `https://www.jne.co.id/tracking-package?awb=${encodeURIComponent(awb)}`,
  },
  jnt: {
    code: 'jnt',
    label: 'J&T',
    // J&T's tracking page is a single-page app; query string is read by the
    // page itself. We also provide a robust aggregator fallback for the
    // generic "Lacak via cekresi" link.
    trackingUrl: (awb) => `https://www.jet.co.id/track?awb=${encodeURIComponent(awb)}`,
  },
  pos: {
    code: 'pos',
    label: 'POS Indonesia',
    trackingUrl: (awb) => `https://www.posindonesia.co.id/id/tracking/${encodeURIComponent(awb)}`,
  },
  tiki: {
    code: 'tiki',
    label: 'TIKI',
    trackingUrl: (awb) => `https://www.tiki.id/id/tracking?connote=${encodeURIComponent(awb)}`,
  },
};

export const COURIER_CODES: CourierCode[] = ['jne', 'jnt', 'pos', 'tiki'];

/** Aggregator yang menerima berbagai kurir Indonesia. Berguna sebagai fallback. */
export function cekresiUrl(awb: string): string {
  return `https://cekresi.com/?noresi=${encodeURIComponent(awb)}`;
}

export function courierLabel(code: string | null | undefined): string {
  if (!code) return '-';
  const c = COURIERS[code as CourierCode];
  return c?.label ?? code.toUpperCase();
}

export function courierTrackingUrl(code: string | null | undefined, awb: string): string {
  if (!code) return cekresiUrl(awb);
  const c = COURIERS[code as CourierCode];
  return c ? c.trackingUrl(awb) : cekresiUrl(awb);
}
