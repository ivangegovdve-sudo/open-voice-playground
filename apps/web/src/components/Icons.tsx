import type { SVGProps } from 'react';

type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'>;

function IconFrame({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 24 24" width="20" {...props}>
      {children}
    </svg>
  );
}

const strokeProps = {
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  strokeWidth: 1.8,
};

export function MenuIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" {...strokeProps} />
    </IconFrame>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m6 6 12 12M18 6 6 18" {...strokeProps} />
    </IconFrame>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <circle cx="11" cy="11" r="6.5" {...strokeProps} />
      <path d="m16 16 4 4" {...strokeProps} />
    </IconFrame>
  );
}

export function FilterIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M4 6h16M7 12h10M10 18h4" {...strokeProps} />
    </IconFrame>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="m9 7 8 5-8 5V7Z" {...strokeProps} />
    </IconFrame>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M9 7v10M15 7v10" {...strokeProps} />
    </IconFrame>
  );
}

export function StarIcon({ fill = 'none', ...props }: IconProps) {
  return (
    <IconFrame {...props}>
      <path
        d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"
        fill={fill}
        {...strokeProps}
      />
    </IconFrame>
  );
}

export function ArrowIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M5 12h14m-5-5 5 5-5 5" {...strokeProps} />
    </IconFrame>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <IconFrame {...props}>
      <path d="M12 4v10m-4-4 4 4 4-4M5 19h14" {...strokeProps} />
    </IconFrame>
  );
}

export function WaveformMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 72 24">
      <path
        d="M1 12h7l3-7 5 14 5-11 5 8 4-4h8l4-8 5 16 5-12 5 8 4-4h10"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}
