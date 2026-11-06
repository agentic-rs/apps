export function Icon({
  name,
  size = 20,
}: {
  name:
    | 'leaf'
    | 'plus'
    | 'arrow'
    | 'back'
    | 'more'
    | 'check'
    | 'book'
    | 'spark'
    | 'close'
    | 'send';
  size?: number;
}) {
  const paths = {
    leaf: (
      <>
        <path d="M19 4c-9-1-15 3-13 10s12 6 13-10Z" />
        <path d="M5 21c0-6 4-10 9-12" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="m9 5 7 7-7 7" />,
    back: <path d="m15 5-7 7 7 7" />,
    more: (
      <>
        <circle cx="5" cy="12" r="1" />
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
    book: (
      <>
        <path d="M12 6c-3-3-7-3-10-2v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 2Z" />
        <path d="M12 6v15" />
      </>
    ),
    spark: (
      <>
        <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" />
      </>
    ),
    close: <path d="m6 6 12 12M6 18 18 6" />,
    send: (
      <>
        <path d="m3 3 18 9-18 9 4-9-4-9Z" />
        <path d="M7 12h14" />
      </>
    ),
  };
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
    >
      {paths[name]}
    </svg>
  );
}
