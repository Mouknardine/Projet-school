// Mise en forme des nombres, montants et dates (format suisse romand).

const LOCALE = 'fr-CH';
/** Nombres au format suisse : 12'345.67 */
const NUMBER_LOCALE = 'de-CH';

export function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return new Intl.NumberFormat(NUMBER_LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

export function fmtMoney(n: number | null | undefined, currency: string, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return `${fmtNum(n, digits)} ${currency}`;
}

export function fmtPrice(n: number | null | undefined): string {
  if (n === null || n === undefined) return '–';
  return fmtNum(n, Math.abs(n) < 10 ? 4 : 2);
}

export function fmtQty(n: number): string {
  return Number.isInteger(n) ? fmtNum(n, 0) : fmtNum(n, 4);
}

export function fmtPct(n: number | null | undefined, digits = 2, withSign = true): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  const sign = withSign && n > 0 ? '+' : '';
  return `${sign}${fmtNum(n, digits)} %`;
}

export function fmtSignedMoney(n: number | null | undefined, currency: string): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return `${n > 0 ? '+' : ''}${fmtMoney(n, currency)}`;
}

export function fmtDateTime(t: number): string {
  return new Date(t).toLocaleString(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(t: number): string {
  return new Date(t).toLocaleDateString(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fmtRelative(t: number | null, now = Date.now()): string {
  if (!t) return 'jamais';
  const s = Math.round((now - t) / 1000);
  if (s < 5) return "à l'instant";
  if (s < 60) return `il y a ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} jours`;
}

export function fmtDuration(ms: number): string {
  const days = Math.floor(ms / 86_400_000);
  if (days >= 1) return `${days} jour${days > 1 ? 's' : ''}`;
  const h = Math.floor(ms / 3_600_000);
  if (h >= 1) return `${h} h`;
  return `${Math.max(1, Math.floor(ms / 60_000))} min`;
}

/** Couleur d'un gain (vert) ou d'une perte (rouge). */
export function pnlClass(n: number | null | undefined): string {
  if (n === null || n === undefined || Math.abs(n) < 1e-9) return 'text-slate-300';
  return n > 0 ? 'text-emerald-400' : 'text-rose-400';
}

const swissTime = (t: number) => new Date(t).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' });

/** Horaires d'ouverture d'une bourse, en heure suisse (« de 15:30 à 22:00 »), ou « 24 h/24 » pour les cryptomonnaies. */
export function fmtSession(session: { start: number; end: number } | null | undefined): string | null {
  if (!session) return null;
  if (session.end - session.start >= 23 * 3_600_000) return 'ouverte 24 h/24, 7 jours sur 7';
  return `ouverte de ${swissTime(session.start)} à ${swissTime(session.end)} (heure suisse), du lundi au vendredi`;
}
