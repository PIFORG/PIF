import type { NavIcon } from '@/lib/navigation/workspaceNav';

export type IconName =
  | NavIcon
  | 'menu'
  | 'close'
  | 'chevron-left'
  | 'chevron-right'
  | 'arrow-up'
  | 'arrow-down'
  | 'arrow-right'
  | 'info'
  | 'lock'
  | 'check'
  | 'alert'
  | 'clock'
  | 'flask';

/** Stroke icons on a 20 px grid (1.6 px strokes). Drawn for MTRS; no third-party icon set. */
const PATHS: Record<IconName, string[]> = {
  overview: ['M3 3h6v6H3zM11 3h6v4h-6zM11 9h6v8h-6zM3 11h6v6H3z'],
  markets: ['M3 16.5h14', 'M4 13l3.5-4 3 2.5L16 5', 'M13 5h3v3'],
  trading: ['M6 3v14M14 3v14', 'M4 6h4v5H4zM12 9h4v5h-4z'],
  portfolio: ['M3 6.5h14v10H3z', 'M7 6.5V4.5h6v2', 'M3 11h14'],
  risk: ['M10 3l7 3v4.5c0 3.6-2.9 5.9-7 6.5-4.1-.6-7-2.9-7-6.5V6z', 'M10 7v4', 'M10 13.5v.01'],
  strategy: ['M4 16V9M10 16V4M16 16v-5', 'M2.5 16.5h15'],
  ai: ['M6.5 6.5h7v7h-7z', 'M8.5 3v3.5M11.5 3v3.5M8.5 13.5V17M11.5 13.5V17M3 8.5h3.5M3 11.5h3.5M13.5 8.5H17M13.5 11.5H17'],
  bank: ['M3 8l7-4.5L17 8', 'M4.5 8.5v6M8 8.5v6M12 8.5v6M15.5 8.5v6', 'M3 16.5h14'],
  xai: ['M3 15.5h4.5V11H3zM8 15.5h4.5V7H8zM13 15.5h4V4h-4z', 'M2.5 17h15'],
  academy: ['M10 4L2.5 7.5 10 11l7.5-3.5z', 'M5.5 9.2v3.6c1.2 1.3 2.7 2 4.5 2s3.3-.7 4.5-2V9.2', 'M17.5 7.5v4'],
  challenge: ['M6 3.5h8v4a4 4 0 0 1-8 0z', 'M10 11.5v3M7 16.5h6', 'M6 5H3.5v1.2A2.5 2.5 0 0 0 6 8.7M14 5h2.5v1.2A2.5 2.5 0 0 1 14 8.7'],
  actuarial: ['M4 3.5h12v13H4z', 'M7 7h6M7 10h6M7 13h3'],
  profile: ['M10 10a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5z', 'M3.5 17c.8-3 3.4-4.8 6.5-4.8s5.7 1.8 6.5 4.8'],
  security: ['M5 9V6.5a5 5 0 0 1 10 0V9', 'M4 9h12v8H4z', 'M10 12v2'],
  sessions: ['M3 4.5h14v9H3z', 'M7.5 16.5h5', 'M10 13.5v3'],
  users: ['M7.5 9.5a2.75 2.75 0 1 0 0-5.5 2.75 2.75 0 0 0 0 5.5z', 'M2.5 16c.6-2.6 2.6-4 5-4s4.4 1.4 5 4', 'M13 4.3a2.75 2.75 0 0 1 0 5.2M14.5 12.3c1.5.5 2.6 1.8 3 3.7'],
  audit: ['M5 3.5h7l3 3v10H5z', 'M12 3.5v3h3', 'M7.5 10h5M7.5 13h5'],
  platform: ['M3 4h14v5H3zM3 11h14v5H3z', 'M6 6.5h.01M6 13.5h.01'],
  menu: ['M3 5.5h14M3 10h14M3 14.5h14'],
  close: ['M5 5l10 10M15 5L5 15'],
  'chevron-left': ['M12 5l-5 5 5 5'],
  'chevron-right': ['M8 5l5 5-5 5'],
  'arrow-up': ['M10 15.5v-11M5.5 9L10 4.5 14.5 9'],
  'arrow-down': ['M10 4.5v11M5.5 11l4.5 4.5 4.5-4.5'],
  'arrow-right': ['M4.5 10h11M11 5.5l4.5 4.5-4.5 4.5'],
  info: ['M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M10 9v4.5M10 6.5v.01'],
  lock: ['M6 9V7a4 4 0 0 1 8 0v2', 'M4.5 9h11v8h-11z'],
  check: ['M4.5 10.5l3.5 3.5 7.5-8'],
  alert: ['M10 3.5l7.5 13h-15z', 'M10 8.5v3.5M10 14.3v.01'],
  clock: ['M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M10 6.5V10l2.5 1.5'],
  flask: ['M8 3h4M8.5 3v5L4 16.5h12L11.5 8V3', 'M6 13h8'],
};

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 18, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
