import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 22, ...props }: IconProps) {
  return { width: size, height: size, viewBox: "0 0 24 24", fill: "none", ...props };
}

export function IconPulse(props: IconProps) {
  return (
    <svg {...base(props)} aria-hidden="true">
      <path
        d="M3 12h4l2-6 4 12 2-6h6"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconSwap(props: IconProps) {
  return (
    <svg {...base(props)} aria-hidden="true">
      <path
        d="M7 7h11M15 4l3 3-3 3M17 17H6M9 14l-3 3 3 3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconBroadcast(props: IconProps) {
  return (
    <svg {...base(props)} aria-hidden="true">
      <path
        d="M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M7.5 15.5a6 6 0 0 1 9 0M5 18a9 9 0 0 1 14 0"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function IconLayers(props: IconProps) {
  return (
    <svg {...base(props)} aria-hidden="true">
      <path
        d="M12 4 4 8l8 4 8-4-8-4ZM4 12l8 4 8-4M4 16l8 4 8-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconWallet(props: IconProps) {
  return (
    <svg {...base(props)} aria-hidden="true">
      <rect x="3" y="6" width="18" height="13" rx="2.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3 10h18" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="16.5" cy="14.5" r="1" fill="currentColor" />
    </svg>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <svg {...base(props)} aria-hidden="true">
      <path d="M8 6.5v11L18 12 8 6.5Z" fill="currentColor" />
    </svg>
  );
}

export function IconStop(props: IconProps) {
  return (
    <svg {...base(props)} aria-hidden="true">
      <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />
    </svg>
  );
}

export function IconCopy(props: IconProps) {
  return (
    <svg {...base(props)} aria-hidden="true">
      <rect x="8" y="8" width="11" height="13" rx="1.8" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M6 16H5.2A1.2 1.2 0 0 1 4 14.8V5.2A1.2 1.2 0 0 1 5.2 4h9.6A1.2 1.2 0 0 1 16 5.2V6"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}
