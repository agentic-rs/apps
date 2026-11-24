import type { CSSProperties } from 'react';

const paths = {
  layers: (
    <>
      <path d="m3 8 9-5 9 5-9 5-9-5Z" />
      <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v.1" />
    </>
  ),
  reorder: <path d="M8 20V4m-4 4 4-4 4 4m4-4v16m-4-4 4 4 4-4" />,
  sort: <path d="M3 5h12M3 10h8M3 15h4m11-9v14m-4-4 4 4 4-4" />,
  grip: <path d="M4 7h16M4 12h16M4 17h16" />,
  filter: (
    <>
      <path d="M3 7h5m5 0h8M3 17h10m5 0h3" />
      <circle cx="10.5" cy="7" r="2.5" />
      <circle cx="15.5" cy="17" r="2.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M7 3v4m10-4v4M3 10h18m-13 4h2m4 0h2" />
    </>
  ),
  landmark: <path d="m3 9 9-6 9 6ZM3 21h18M5 18h14M7 12v6m5-6v6m5-6v6" />,
  bed: (
    <>
      <path d="M3 5v15m18-2H3m18 2v-8a2 2 0 0 0-2-2h-7v5H3m18 0h-9" />
      <circle cx="7.5" cy="10" r="2" />
    </>
  ),
  food: <path d="M5 3v5a3 3 0 0 0 6 0V3M8 3v18m11 0V3c-3 1-4 5-4 9h4" />,
  plane: <path d="m21 3-1 4-5 5 1 7-2 2-3-6-4 3-1 3-2-2 1-3 3-4-6-3 2-2 7 1 5-5 4-1Z" />,
  toolbox: (
    <>
      <rect x="3" y="7" width="18" height="14" rx="3" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12c5 3 13 3 18 0m-9 1v3" />
    </>
  ),
  checklist: (
    <>
      <path d="m3 6 2 2 3-4m-5 10 2 2 3-4m3-6h10m-10 8h10" />
    </>
  ),
  wallet: (
    <>
      <path d="M19 7V4L5 6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h15V8H5" />
      <path d="M20 11h-4a2 2 0 0 0 0 4h4" />
    </>
  ),
  route: (
    <>
      <circle cx="5" cy="6" r="2" />
      <circle cx="19" cy="18" r="2" />
      <path d="M7 6h9a3 3 0 0 1 0 6H8a3 3 0 0 0 0 6h9" />
    </>
  ),
  back: <path d="m14 5-7 7 7 7" />,
  next: <path d="m10 5 7 7-7 7" />,
  map: (
    <>
      <path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2Zm6-2v16m6-14v16" />
    </>
  ),
  timeline: (
    <>
      <path d="M7 4v16M12 5h8M12 12h6M12 19h8" />
      <circle cx="7" cy="5" r="2" fill="currentColor" stroke="none" />
      <circle cx="7" cy="12" r="2" fill="currentColor" stroke="none" />
      <circle cx="7" cy="19" r="2" fill="currentColor" stroke="none" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m16 8-2.5 5.5L8 16l2.5-5.5Z" />
    </>
  ),
  pin: (
    <>
      <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
      <circle cx="12" cy="10" r="2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  camera: (
    <>
      <path d="M8 6 9.5 3h5L16 6h4a1 1 0 0 1 1 1v12H3V7a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="12" r="4" />
    </>
  ),
  photo: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8" cy="8" r="1" />
      <path d="m3 16 5-5 5 5 3-3 5 5" />
    </>
  ),
  book: (
    <>
      <path d="M4 4h13a2 2 0 0 1 2 2v15H6a2 2 0 0 1-2-2Zm0 13h15M8 4v13" />
    </>
  ),
  locate: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2" />
      <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
    </>
  ),
  edit: (
    <>
      <path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
    </>
  ),
  search: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="m15 15 6 6" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
} as const;

export function Icon({
  name,
  size = 20,
  style,
}: {
  name: keyof typeof paths;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {paths[name]}
    </svg>
  );
}
