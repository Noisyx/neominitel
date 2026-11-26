import type { ReactElement, ReactNode } from 'react';
import { CHANNELS } from '../../modem';

export interface MinitelShellProps {
  online: boolean;
  statusLabel?: string;
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
          viewBox="0 0 680 28"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <rect x="0" y="2" width="680" height="22" rx="5" fill="#C9BDA4" />
          <line x1="12" y1="5" x2="668" y2="5" stroke="#E5DEC9" strokeWidth="1.5" />
          {Array.from({ length: 18 }, (_, i) => {
            const x = 36 + i * 22;
            return (
              <rect
                key={x}
                x={x}
                y="9"
                width="12"
                height="10"
                rx="2"
                fill="#8E816B"
              />
            );
          })}
          <rect x="536" y="8" width="116" height="12" rx="2" fill="#B7AA90" />
        </svg>

        <div className="nm-shell-bezel">{children}</div>

        <div className="nm-shell-chin">
          <span className="nm-shell-badge">NEOMINITEL · TERMINAL V.23</span>
          <span className="nm-shell-pilot">
            <span
              className="nm-pilot-dot"
              data-online={online ? 'true' : 'false'}
              aria-hidden="true"
            />
            {label}
          </span>
        </div>

        {footerSlot}
      </div>
    </section>
  );
}
