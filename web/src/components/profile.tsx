// Éléments visuels du profil d'investisseur : jauge de risque et niveau d'agitation d'une action.

import { BANDS, bandOf, dailyMove, PROFILES, type RiskBand } from '../../../shared/profile.ts';
import type { RiskLevel } from '../../../shared/types.ts';
import { fmtNum } from '../lib/format.ts';
import { cx } from './ui.tsx';

/** Du vert (prudent) au rouge (audacieux). */
export const LEVEL_COLORS: Record<RiskLevel, string> = { 1: '#2ebd85', 2: '#8ccf5a', 3: '#fab219', 4: '#f08a3c', 5: '#f6465d' };

/** Jauge en 5 cases : le profil de risque d'un coup d'œil. */
export function RiskGauge({ level, className, showLabels = false }: { level: RiskLevel; className?: string; showLabels?: boolean }) {
  return (
    <div className={className} role="img" aria-label={`Profil de risque ${level} sur 5 : ${PROFILES[level].name}`}>
      <div className="flex gap-1">
        {([1, 2, 3, 4, 5] as RiskLevel[]).map((l) => (
          <span
            key={l}
            className={cx('h-2 flex-1 rounded-full transition-opacity', l > level && 'opacity-20')}
            style={{ background: LEVEL_COLORS[l] }}
          />
        ))}
      </div>
      {showLabels && (
        <div className="mt-1.5 flex justify-between text-[11px] text-ink-3">
          <span>Prudent</span>
          <span>Audacieux</span>
        </div>
      )}
    </div>
  );
}

/** Pastille « Profil Équilibré » avec sa couleur. */
export function ProfileBadge({ level, className }: { level: RiskLevel; className?: string }) {
  return (
    <span
      className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold', className)}
      style={{ background: `${LEVEL_COLORS[level]}22`, color: LEVEL_COLORS[level] }}
    >
      <span className="size-1.5 rounded-full" style={{ background: LEVEL_COLORS[level] }} aria-hidden />
      Profil {PROFILES[level].name}
    </span>
  );
}

const BAND_COLORS: Record<RiskBand, string> = {
  very_calm: '#2ebd85',
  calm: '#8ccf5a',
  medium: '#fab219',
  agitated: '#f08a3c',
  very_agitated: '#f6465d',
};

/** Niveau d'agitation d'une action, avec sa variation typique sur une journée (plus parlante qu'une volatilité). */
export function AgitationChip({ volatility }: { volatility: number }) {
  const band = bandOf(volatility);
  const label = BANDS.find((b) => b.id === band)?.label ?? '';
  const color = BAND_COLORS[band];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-ink-3">
      <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium" style={{ background: `${color}22`, color }}>
        <span className="size-1.5 rounded-full" style={{ background: color }} aria-hidden />
        {label}
      </span>
      bouge d'environ {fmtNum(dailyMove(volatility), 1)}&nbsp;% par jour
    </span>
  );
}
