import type { ReactElement, ReactNode } from 'react';
import { CHANNELS } from '../../modem';

export interface MinitelShellProps {
  online: boolean;
  statusLabel?: string;
  chinControls?: ReactNode;
  children: ReactNode;
  footerSlot?: ReactNode;
}

/**
 * Original 1980s-inspired desktop Videotex terminal casing (SVG ventilation brow,
 * moulded beige housing, dark recessed CRT hood, and pilot indicator).
 * Contains zero third-party logos or trademarks (Requirement 9.1).
 */
export function MinitelShell({
  online,
  statusLabel,
  chinControls,
  children,
  footerSlot,
}: MinitelShellProps): ReactElement {
  const label =
    statusLabel ??
    (online ? `En ligne · ${CHANNELS.forward.baud} / ${CHANNELS.backward.baud} bd` : 'Veille');

  return (
    <section
      id="nm-terminal-main"
      tabIndex={-1}
      className="nm-shell"
      aria-label="Terminal NeoMinitel"
    >
      <div className="nm-shell-frame">
        {/* Original SVG top brow with cooling louvres and bevelled industrial ridge */}
        <svg
          className="nm-shell-svg-decor"
          viewBox="0 0 680 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <rect x="0" y="1" width="680" height="14" rx="4" fill="#BFB49F" />
          <line x1="12" y1="3" x2="668" y2="3" stroke="#D9D0BE" strokeWidth="1" />
          {Array.from({ length: 18 }, (_, i) => {
            const x = 32 + i * 22;
            return (
              <rect
                key={x}
                x={x}
                y="5"
                width="12"
                height="6"
                rx="1.5"
                fill="#857A67"
              />
            );
          })}
          <rect x="544" y="5" width="108" height="6" rx="1.5" fill="#ABA08B" />
        </svg>

        <div className="nm-shell-bezel">{children}</div>

        <div className="nm-shell-chin">
          <div className="nm-shell-chin-left">
            <span className="nm-shell-badge">NeoMinitel</span>
            <span className="nm-shell-pilot">
              <span
                className="nm-pilot-dot"
                data-online={online ? 'true' : 'false'}
                aria-hidden="true"
              />
              {label}
            </span>
          </div>
          {chinControls && (
            <div className="nm-shell-chin-controls">{chinControls}</div>
          )}
        </div>

        {footerSlot}
      </div>
    </section>
  );
}
