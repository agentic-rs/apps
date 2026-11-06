import type { CSSProperties } from 'react';

const paths = {
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
  chevron: <path d="m6 9 6 6 6-6" />,
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
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      {paths[name]}
    </svg>
  );
}
