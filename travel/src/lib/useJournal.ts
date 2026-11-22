import { useEffect, useRef, useState } from 'react';
import { emptyJournal } from './model';
import { createPlatform } from './platform';
import type { Journal, PhotoAsset, TravelPlatform } from './types';

export function useJournal() {
  const [platform, setPlatform] = useState<TravelPlatform | null>(null);
  const [journal, setJournal] = useState<Journal>(emptyJournal);
  const [load_error, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState('');
  const latest = useRef(journal);
  const writes = useRef(Promise.resolve());

  useEffect(() => {
    let live = true;
    setLoadError('');
    createPlatform()
      .then(async (next) => {
        const data = await next.load();
        if (live) {
          latest.current = data;
          setJournal(data);
          setPlatform(next);
        }
      })
      .catch((error) => {
        if (live)
          setLoadError(error instanceof Error ? error.message : 'Your trips could not be opened.');
      });
    return () => {
      live = false;
    };
  }, [reload]);

  // Apply each edit to the last successful write, including when a previous edit failed.
  function persist(change: (snapshot: Journal) => Journal) {
    const next_write = writes.current.then(async () => {
      const next = change(latest.current);
      await platform!.save(next);
      latest.current = next;
      setJournal(next);
      setNotice('');
    });
    writes.current = next_write.catch(() => {});
    return next_write;
  }

  async function cleanPhotos(assets: PhotoAsset[]) {
    const unique = [...new Map(assets.map((photo) => [photo.path, photo])).values()];
    const results = await Promise.allSettled(unique.map((photo) => platform!.removePhoto(photo)));
    if (results.some((result) => result.status === 'rejected'))
      setNotice('Some unused photo files could not be removed from storage.');
  }
  return {
    journal,
    platform,
    load_error,
    retry: () => setReload((value) => value + 1),
    persist,
    cleanPhotos,
    notice,
    setNotice,
  };
}
