import { useEffect, useRef, useState } from 'react';
import type { PhotoAsset, TravelPlatform } from '../lib/types';
import { Icon } from './Icon';

export function Photo({
  photo,
  platform,
  alt,
  onOpen,
}: {
  photo: PhotoAsset;
  platform: TravelPlatform;
  alt: string;
  onOpen?: () => void;
}) {
  const frame = useRef<HTMLElement | null>(null);
  const displayed_url = useRef('');
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState('');
  useEffect(() => {
    let live = true;
    let visible = false;
    let reading = false;
    let object_url = '';
    let observer: IntersectionObserver | undefined;
    setUrl('');
    setFailure('');
    setLoading(false);

    function release() {
      if (object_url) URL.revokeObjectURL(object_url);
      object_url = '';
      displayed_url.current = '';
    }

    async function load() {
      setLoading(true);
      // Re-entering the viewport while a native read is pending reuses that read.
      if (reading) return;
      reading = true;
      try {
        const blob = await platform.readPhoto(photo);
        if (!live || !visible) return;
        object_url = URL.createObjectURL(blob);
        displayed_url.current = object_url;
        setUrl(object_url);
      } catch {
        if (live && visible) setFailure('The saved photo could not be opened.');
      } finally {
        reading = false;
        if (live && visible) setLoading(false);
      }
    }

    function setVisible(next: boolean) {
      if (!live || visible === next) return;
      visible = next;
      setFailure('');
      if (visible) {
        void load();
      } else {
        // Offscreen originals can be large; release their bytes while preserving the frame.
        release();
        setUrl('');
        setLoading(false);
      }
    }

    if (typeof IntersectionObserver === 'undefined' || !frame.current) {
      setVisible(true);
    } else {
      observer = new IntersectionObserver(
        (entries) => {
          const entry = entries.at(-1);
          if (entry) setVisible(entry.isIntersecting);
        },
        { rootMargin: '320px 0px' },
      );
      observer.observe(frame.current);
    }
    return () => {
      live = false;
      observer?.disconnect();
      release();
    };
  }, [platform, photo.path, photo.id, photo.mime_type, photo.size_bytes]);

  const content = failure ? (
    <span
      className="photo-fallback"
      role="img"
      aria-label={`${alt}. Preview unavailable. ${failure}`}
    >
      <Icon name="photo" />
      <span>Preview unavailable</span>
      <span>{failure}</span>
    </span>
  ) : url ? (
    <img
      key={url}
      src={url}
      alt={alt}
      loading="lazy"
      onError={(event) => {
        if (event.currentTarget.getAttribute('src') === displayed_url.current) {
          setFailure('This image format may not be supported on this device.');
        }
      }}
    />
  ) : (
    <span className="photo-fallback">
      <Icon name="photo" />
      <span>{loading ? 'Loading photo…' : 'Photo'}</span>
    </span>
  );
  const attachFrame = (element: HTMLElement | null) => {
    frame.current = element;
  };
  return onOpen ? (
    <button
      ref={attachFrame}
      type="button"
      className="photo-frame"
      onClick={onOpen}
      aria-label={`Open photo: ${alt}${failure ? `. Preview unavailable. ${failure}` : ''}`}
    >
      {content}
    </button>
  ) : (
    <div ref={attachFrame} className="photo-frame">
      {content}
    </div>
  );
}
