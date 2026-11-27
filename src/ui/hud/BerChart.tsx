import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  berNoncoherentCorrelated,
  berOrthogonalNoncoherent,
  FORWARD_RHO,
} from '../../modem';

export interface Curve3Dataset {
  readonly ebN0Db: readonly number[];
  readonly ber: readonly number[];
  readonly lo: readonly number[];
  readonly hi: readonly number[];
}

/**
 * Baseline snapshot of `public/data/ber-curve3.json` for immediate synchronous first paint & SSR;
 * refreshed over HTTP from `/data/ber-curve3.json` on mount in the browser so Vite never imports `public/`.
 */
const DEFAULT_CURVE3_DATA: Curve3Dataset = {
  ebN0Db: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
  ber: [
    0.7033325810576996, 0.6934978711120733, 0.6812535106396875,
    0.6617030401219861, 0.636789887078175, 0.6000168339147268,
    0.5492316497108543, 0.4806386123094836, 0.3734264735478761,
    0.2636399499168139, 0.15798203675840006, 0.0764561311412823,
    0.03225850845684874, 0.011593784793750535, 0.003200737736474085,
    0.0005851061454011104, 0.00009823007269025379, 0, 0,
  ],
  lo: [
    0.699848149094832, 0.6900542057832881, 0.6779434361165618,
    0.6584950279531079, 0.6336752112540038, 0.597076893019165,
    0.5463797869099867, 0.4779638380195398, 0.37101398744789094,
    0.2615802492018489, 0.156368830393676, 0.0753261153780937,
    0.0315249909621531, 0.011156700864665185, 0.0029748895704565744,
    0.0004931423682016601, 0.0000648731872186558, 0, 0,
  ],
  hi: [
    0.7067935096037905, 0.6969200801311699, 0.6845453946661334,
    0.6648962526632124, 0.6398931299468016, 0.6029495883959032,
    0.5520802815607524, 0.4833144968798367, 0.37584527300581083,
    0.2657100329543127, 0.15960873733090733, 0.07760167632581425,
    0.03300851159117111, 0.012047783647590321, 0.003443672660172628,
    0.0006942078990052106, 0.00014873605086760346, 0.000017151237216747512,
    0.000017151237216747512,
  ],
};

/**
 * Baseline snapshot (BER only) of `public/data/ber-curve4.json`: the correlator receiver of
 * v23-modem task 15, same chain, grid and seeds as curve 3. Refreshed over HTTP on mount like
 * curve 3; drawn as a line without its band to keep the chart readable.
 */
const DEFAULT_CURVE4_DATA: Curve3Dataset = {
  ebN0Db: DEFAULT_CURVE3_DATA.ebN0Db,
  ber: [
    0.6871, 0.6829, 0.6688, 0.6561, 0.6231, 0.5819, 0.4982, 0.3855, 0.2538, 0.1477, 0.07765,
    0.03734, 0.01587, 0.005319, 0.001769, 0.0005984, 0.0001786, 0.00005358, 0.000004465,
  ],
  lo: DEFAULT_CURVE3_DATA.lo,
  hi: DEFAULT_CURVE3_DATA.hi,
};

function linePath(curve: Curve3Dataset): string {
  return curve.ebN0Db
    .map((db, i) => `${i === 0 ? 'M' : 'L'}${dbToX(db).toFixed(1)},${berToY(curve.ber[i]).toFixed(1)}`)
    .join(' ');
}

function isValidCurve3Dataset(val: unknown): val is Curve3Dataset {
  if (!val || typeof val !== 'object') return false;
  const c = val as Record<string, unknown>;
  return (
    Array.isArray(c.ebN0Db) &&
    Array.isArray(c.ber) &&
    Array.isArray(c.lo) &&
    Array.isArray(c.hi) &&
    c.ebN0Db.length > 0 &&
    c.ber.length === c.ebN0Db.length &&
    c.lo.length === c.ebN0Db.length &&
    c.hi.length === c.ebN0Db.length
  );
}

export interface BerPoint {
  readonly ebN0Db: number;
  readonly bits: number;
  readonly errors: number;
  readonly ber: number;
  readonly lo: number;
  readonly hi: number;
}

export interface BerChartProps {
  points: readonly BerPoint[];
  onClearPoints?: () => void;
}

const SVG_W = 280;
const SVG_H = 172;
const PLOT_X0 = 36;
const PLOT_X1 = 270;
const PLOT_Y0 = 12;
const PLOT_Y1 = 146;

const MIN_DB = 0;
const MAX_DB = 18;
const MIN_LOG_BER = -5; // 10^-5
const MAX_LOG_BER = 0; // 10^0 = 1

function dbToX(db: number): number {
  const clamped = Math.max(MIN_DB, Math.min(MAX_DB, db));
  return PLOT_X0 + ((clamped - MIN_DB) / (MAX_DB - MIN_DB)) * (PLOT_X1 - PLOT_X0);
}

function berToY(ber: number): number {
  const safe = Number.isFinite(ber) ? Math.max(1e-5, Math.min(1, ber)) : 1e-5;
  const logVal = Math.log10(safe);
  const norm = (logVal - MIN_LOG_BER) / (MAX_LOG_BER - MIN_LOG_BER);
  return PLOT_Y1 - norm * (PLOT_Y1 - PLOT_Y0);
}

interface StaticCurvesGeometry {
  curve1Path: string;
  curve2Path: string;
  curve3Path: string;
  curve3BandPolygon: string;
}

function buildCurvesGeometry(curve3: Curve3Dataset): StaticCurvesGeometry {
  const c1: string[] = [];
  const c2: string[] = [];
  for (let step = 0; step <= 36; step++) {
    const db = step * 0.5;
    const x = dbToX(db).toFixed(1);
    const y1 = berToY(berOrthogonalNoncoherent(db)).toFixed(1);
    const y2 = berToY(berNoncoherentCorrelated(db, FORWARD_RHO)).toFixed(1);
    c1.push(`${step === 0 ? 'M' : 'L'}${x},${y1}`);
    c2.push(`${step === 0 ? 'M' : 'L'}${x},${y2}`);
  }

  const c3: string[] = [];
  const upperPts: string[] = [];
  const lowerPts: string[] = [];
  const n = curve3.ebN0Db.length;
  for (let i = 0; i < n; i++) {
    const db = curve3.ebN0Db[i];
    const x = dbToX(db).toFixed(1);
    const yMean = berToY(curve3.ber[i]).toFixed(1);
    const yHi = berToY(curve3.hi[i]).toFixed(1);
    const yLo = berToY(curve3.lo[i]).toFixed(1);
    c3.push(`${i === 0 ? 'M' : 'L'}${x},${yMean}`);
    upperPts.push(`${x},${yHi}`);
    lowerPts.unshift(`${x},${yLo}`);
  }

  return {
    curve1Path: c1.join(' '),
    curve2Path: c2.join(' '),
    curve3Path: c3.join(' '),
    curve3BandPolygon: [...upperPts, ...lowerPts].join(' '),
  };
}

function formatSciBer(ber: number): string {
  if (ber <= 0) return '0';
  if (ber >= 0.01) return `${(ber * 100).toFixed(1)} %`;
  return ber.toExponential(1);
}

/**
 * Plots the three V.23 BER curves (1: orthogonal BFSK, 2: correlated Marcum Q1 h=2/3,
 * 3: discriminator Monte Carlo with 95% Wilson band) and live PN9 points with 95% intervals
 * (Requirements 6.2, 6.3, 8.4).
 */
export function BerChart({ points, onClearPoints }: BerChartProps): ReactElement {
  const [curve3Data, setCurve3Data] = useState<Curve3Dataset>(DEFAULT_CURVE3_DATA);
  const [curve4Data, setCurve4Data] = useState<Curve3Dataset>(DEFAULT_CURVE4_DATA);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof fetch !== 'function') {
      return;
    }
    let cancelled = false;
    const base =
      (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    const prefix = base.endsWith('/') ? base : `${base}/`;
    void fetch(`${prefix}data/ber-curve3.json`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json: unknown) => {
        if (!cancelled && isValidCurve3Dataset(json)) {
          setCurve3Data(json);
        }
      })
      .catch(() => {
        // Keep embedded baseline Curve 3 data if offline or unreachable
      });
    void fetch(`${prefix}data/ber-curve4.json`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json: unknown) => {
        if (!cancelled && isValidCurve3Dataset(json)) {
          setCurve4Data(json);
        }
      })
      .catch(() => {
        // Keep embedded baseline Curve 4 data if offline or unreachable
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const geometry = useMemo(
    () => buildCurvesGeometry(curve3Data),
    [curve3Data],
  );
  const curve4Path = useMemo(() => linePath(curve4Data), [curve4Data]);
  const latest = points.length > 0 ? points[points.length - 1] : null;
  const srSummary = latest
    ? `Courbes BER V.23 : ${points.length} point(s) mesuré(s). Dernier point à Eb/N0 ${latest.ebN0Db.toFixed(1)} dB : BER ${formatSciBer(latest.ber)} (intervalle Wilson 95 % de ${formatSciBer(latest.lo)} à ${formatSciBer(latest.hi)} sur ${latest.bits} bits).`
    : 'Courbes BER V.23 : 4 courbes affichées (FSK orthogonal, Marcum Q1 h=2/3, discriminateur Monte Carlo, corrélateurs Monte Carlo). Aucun point PN9 mesuré pour le moment.';

  const dbTicks = [0, 6, 12, 18];
  const logTicks: readonly { exp: number; label: string }[] = [
    { exp: 0, label: '1' },
    { exp: -1, label: '10⁻¹' },
    { exp: -2, label: '10⁻²' },
    { exp: -3, label: '10⁻³' },
    { exp: -4, label: '10⁻⁴' },
    { exp: -5, label: '10⁻⁵' },
  ];

  return (
    <div className="nm-hud-card nm-ber-card" role="region" aria-label="Banc d'essai BER et courbes théoriques">
      <div className="nm-hud-card-header">
        <span className="nm-hud-card-title">Courbes BER · Banc PN9</span>
        {points.length > 0 && onClearPoints ? (
          <button
            type="button"
            className="nm-hud-mini-btn"
            onClick={onClearPoints}
          >
            Effacer ({points.length})
          </button>
        ) : (
          <span className="nm-hud-card-meta">0 – 18 dB</span>
        )}
      </div>

      <svg
        className="nm-ber-svg"
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        role="img"
        aria-label={srSummary}
      >
        <rect
          x={PLOT_X0}
          y={PLOT_Y0}
          width={PLOT_X1 - PLOT_X0}
          height={PLOT_Y1 - PLOT_Y0}
          fill="#0a0d0c"
          stroke="rgba(235, 228, 214, 0.14)"
          strokeWidth="1"
        />

        {/* Horizontal log-BER gridlines */}
        {logTicks.map((t) => {
          const y = berToY(Math.pow(10, t.exp));
          return (
            <g key={t.exp}>
              <line
                x1={PLOT_X0}
                y1={y}
                x2={PLOT_X1}
                y2={y}
                stroke="rgba(235, 228, 214, 0.08)"
                strokeWidth="1"
              />
              <text
                x={PLOT_X0 - 4}
                y={y + 3}
                textAnchor="end"
                fill="#8e8677"
                fontSize="8.5"
                fontFamily="ui-monospace, monospace"
              >
                {t.label}
              </text>
            </g>
          );
        })}

        {/* Vertical Eb/N0 gridlines */}
        {dbTicks.map((db) => {
          const x = dbToX(db);
          return (
            <g key={db}>
              <line
                x1={x}
                y1={PLOT_Y0}
                x2={x}
                y2={PLOT_Y1}
                stroke="rgba(235, 228, 214, 0.08)"
                strokeWidth="1"
              />
              <text
                x={x}
                y={SVG_H - 6}
                textAnchor="middle"
                fill="#8e8677"
                fontSize="8.5"
                fontFamily="ui-monospace, monospace"
              >
                {`${db} dB`}
              </text>
            </g>
          );
        })}

        {/* Curve 3 95% Wilson Monte Carlo band */}
        <polygon
          points={geometry.curve3BandPolygon}
          fill="rgba(229, 184, 75, 0.18)"
        />

        {/* Curve 1: Orthogonal non-coherent BFSK */}
        <path
          d={geometry.curve1Path}
          fill="none"
          stroke="#6fd977"
          strokeWidth="1.3"
          strokeDasharray="3 2"
        />

        {/* Curve 2: Correlated non-coherent BFSK (Marcum Q1, h = 2/3) */}
        <path
          d={geometry.curve2Path}
          fill="none"
          stroke="#64d2ff"
          strokeWidth="1.4"
        />

        {/* Curve 3: Our discriminator + 7E1 UART chain (Monte Carlo) */}
        <path
          d={geometry.curve3Path}
          fill="none"
          stroke="#e5b84b"
          strokeWidth="1.6"
        />

        {/* Curve 4: correlator receiver (v23-modem task 15, Monte Carlo) */}
        <path
          d={curve4Path}
          fill="none"
          stroke="#d18cff"
          strokeWidth="1.4"
          strokeDasharray="5 2"
        />

        {/* Live measured PN9 points with 95% Wilson intervals */}
        {points.map((pt) => {
          const x = dbToX(pt.ebN0Db);
          const yCenter = berToY(pt.ber);
          const yLo = berToY(pt.lo);
          const yHi = berToY(pt.hi);
          return (
            <g key={pt.ebN0Db.toFixed(2)}>
              <line
                x1={x}
                y1={yHi}
                x2={x}
                y2={yLo}
                stroke="#ff8a65"
                strokeWidth="1.5"
              />
              <line
                x1={x - 3}
                y1={yHi}
                x2={x + 3}
                y2={yHi}
                stroke="#ff8a65"
                strokeWidth="1.3"
              />
              <line
                x1={x - 3}
                y1={yLo}
                x2={x + 3}
                y2={yLo}
                stroke="#ff8a65"
                strokeWidth="1.3"
              />
              <circle
                cx={x}
                cy={yCenter}
                r="3.2"
                fill={pt.errors === 0 ? '#121210' : '#ede7da'}
                stroke="#ff8a65"
                strokeWidth="1.6"
              />
            </g>
          );
        })}
      </svg>

      <div className="nm-ber-legend" aria-hidden="true">
        <span className="nm-legend-c1">1. Orthog.</span>
        <span className="nm-legend-c2">2. Marcum h=2/3</span>
        <span className="nm-legend-c3">3. Discrim. MC</span>
        <span className="nm-legend-c4">4. Corrél. MC</span>
        <span className="nm-legend-pt">● Mesure 95%</span>
      </div>

      {latest ? (
        <p className="nm-vote-note">
          {`Dernier point (${latest.ebN0Db.toFixed(1)} dB) : BER ${formatSciBer(latest.ber)} [${formatSciBer(latest.lo)} – ${formatSciBer(latest.hi)}] sur ${latest.bits} bits`}
        </p>
      ) : (
        <p className="nm-vote-note">
          Ouvrez 3615 MATHS → BANC pour émettre la séquence PN9 et tracer les points
        </p>
      )}

      <p className="nm-sr-only">{srSummary}</p>
    </div>
  );
}
