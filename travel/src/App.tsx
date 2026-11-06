import { useEffect, useMemo, useState } from 'react';
import { createPlatform } from './lib/platform';
import { emptyJournal, removeCheckIn, removeTrip, saveCheckIn, upsertTrip } from './lib/model';
import type { CheckIn, Journal, PhotoAsset, TravelPlatform, Trip } from './lib/types';
import { Icon } from './components/Icon';
import { Dialog } from './components/Dialog';
import { TripForm } from './components/TripForm';
import { CheckInForm } from './components/CheckInForm';
import { Photo } from './components/Photo';
import { TimelineView } from './components/TimelineView';
import { MapView } from './components/MapView';
import { TripsDialog } from './components/TripsDialog';
import { VisitCard } from './components/VisitCard';

type Editor =
  | { kind: 'trip'; trip?: Trip; then_check_in?: boolean }
  | { kind: 'visit'; trip: Trip; visit?: CheckIn }
  | null;
type Removal = { kind: 'trip'; trip: Trip } | { kind: 'visit'; visit: CheckIn } | null;
type View = 'timeline' | 'map';
type OpenPhoto = { asset: PhotoAsset; caption: string } | null;

export function App() {
  const [platform, setPlatform] = useState<TravelPlatform | null>(null);
  const [journal, setJournal] = useState<Journal>(emptyJournal);
  const [loading, setLoading] = useState(true);
  const [load_error, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState('');
  const [selected_trip_id, setSelectedTripId] = useState('');
  const [view, setView] = useState<View>('timeline');
  const [map_opened, setMapOpened] = useState(false);
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<Editor>(null);
  const [trip_dialog, setTripDialog] = useState<'manage' | 'check_in' | null>(null);
  const [detail_id, setDetailId] = useState<string | null>(null);
  const [removal, setRemoval] = useState<Removal>(null);
  const [deleting, setDeleting] = useState(false);
  const [delete_error, setDeleteError] = useState('');
  const [open_photo, setOpenPhoto] = useState<OpenPhoto>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setLoadError('');
    createPlatform()
      .then(async (next) => {
        const data = await next.load();
        if (live) {
          setPlatform(next);
          setJournal(data);
        }
      })
      .catch((error) => {
        if (live)
          setLoadError(
            error instanceof Error ? error.message : 'Your journal could not be opened.',
          );
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [reload]);

  const selected_trip = journal.trips.find((trip) => trip.id === selected_trip_id);
  const visits = useMemo(
    () =>
      journal.check_ins
        .filter((visit) => !selected_trip_id || visit.trip_id === selected_trip_id)
        .sort((a, b) => b.visited_at.localeCompare(a.visited_at) || a.id.localeCompare(b.id)),
    [journal.check_ins, selected_trip_id],
  );
  const detail_visit = journal.check_ins.find((visit) => visit.id === detail_id);
  const detail_place = journal.places.find((place) => place.id === detail_visit?.place_id);
  const detail_trip = journal.trips.find((trip) => trip.id === detail_visit?.trip_id);

  function switchView(next: View) {
    if (next === 'map') setMapOpened(true);
    setView(next);
  }
  function startCheckIn() {
    setDetailId(null);
    const trip = selected_trip ?? (journal.trips.length === 1 ? journal.trips[0] : undefined);
    if (trip) setEditor({ kind: 'visit', trip });
    else if (!journal.trips.length) setEditor({ kind: 'trip', then_check_in: true });
    else setTripDialog('check_in');
  }
  async function persist(next: Journal) {
    await platform!.save(next);
    setJournal(next);
    setNotice('');
  }
  async function cleanPhotos(assets: PhotoAsset[]) {
    const unique = [...new Map(assets.map((photo) => [photo.path, photo])).values()];
    const results = await Promise.allSettled(unique.map((photo) => platform!.removePhoto(photo)));
    if (results.some((result) => result.status === 'rejected'))
      setNotice('Some unused photo files could not be removed from storage.');
  }
  async function deleteEntry() {
    if (!removal || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const assets =
        removal.kind === 'visit'
          ? removal.visit.photos
          : journal.check_ins
              .filter((visit) => visit.trip_id === removal.trip.id)
              .flatMap((visit) => visit.photos);
      await persist(
        removal.kind === 'trip'
          ? removeTrip(journal, removal.trip.id)
          : removeCheckIn(journal, removal.visit.id),
      );
      if (removal.kind === 'trip' && removal.trip.id === selected_trip_id) setSelectedTripId('');
      setDetailId(null);
      setRemoval(null);
      await cleanPhotos(assets);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Could not delete this item.');
    } finally {
      setDeleting(false);
    }
  }

  if (loading || load_error || !platform)
    return (
      <div className="startup">
        <span className="brand-symbol">
          <Icon name="compass" size={30} />
        </span>
        <h1>Fieldnotes</h1>
        {load_error ? (
          <>
            <p role="alert">{load_error}</p>
            <p>Your saved journal has not been replaced.</p>
            <button className="primary" onClick={() => setReload((value) => value + 1)}>
              Try again
            </button>
          </>
        ) : (
          <p>Opening your journal…</p>
        )}
      </div>
    );

  return (
    <div className={`app-shell${platform.native ? ' native' : ''}`}>
      <header className="view-header">
        <h1>{view === 'timeline' ? 'Timeline' : 'Map'}</h1>
        <label className="trip-filter">
          <span className="sr-only">Trip filter</span>
          <select
            value={selected_trip_id}
            onChange={(event) => setSelectedTripId(event.target.value)}
          >
            <option value="">All trips</option>
            {journal.trips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.title}
              </option>
            ))}
          </select>
          <Icon name="chevron" size={14} />
        </label>
        <button className="header-trips" onClick={() => setTripDialog('manage')}>
          <Icon name="book" size={17} />
          Trips
        </button>
      </header>
      {notice && (
        <div className="notice" role="status">
          {notice}
          <button className="icon-button" aria-label="Dismiss notice" onClick={() => setNotice('')}>
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      <main className="app-content">
        <div className="timeline-panel" hidden={view !== 'timeline'}>
          <TimelineView
            visits={visits}
            places={journal.places}
            trips={journal.trips}
            platform={platform}
            search={search}
            has_trips={journal.trips.length > 0}
            onSearch={setSearch}
            onCreate={() => (journal.trips.length ? startCheckIn() : setEditor({ kind: 'trip' }))}
            onOpenVisit={setDetailId}
            onPhoto={(asset, caption) => setOpenPhoto({ asset, caption })}
          />
        </div>
        {map_opened && (
          <div className="map-panel" hidden={view !== 'map'}>
            <MapView
              visits={visits}
              places={journal.places}
              platform={platform}
              active={view === 'map'}
              onOpenVisit={setDetailId}
            />
          </div>
        )}
      </main>
      <footer className="bottom-bar">
        <nav aria-label="Main views">
          <button
            aria-current={view === 'timeline' ? 'page' : undefined}
            onClick={() => switchView('timeline')}
          >
            <Icon name="timeline" size={23} />
            <span>Timeline</span>
          </button>
          <button
            aria-current={view === 'map' ? 'page' : undefined}
            onClick={() => switchView('map')}
          >
            <Icon name="map" size={23} />
            <span>Map</span>
          </button>
        </nav>
        <button className="add-check-in" aria-label="New check-in" onClick={startCheckIn}>
          <Icon name="plus" size={27} />
        </button>
      </footer>
      {trip_dialog && (
        <TripsDialog
          trips={journal.trips}
          visits={journal.check_ins}
          choosing={trip_dialog === 'check_in'}
          onClose={() => setTripDialog(null)}
          onSelect={(trip) => {
            const choosing = trip_dialog === 'check_in';
            setTripDialog(null);
            if (choosing) setEditor({ kind: 'visit', trip });
            else setSelectedTripId(trip.id);
          }}
          onCreate={() => {
            const choosing = trip_dialog === 'check_in';
            setTripDialog(null);
            setEditor({ kind: 'trip', then_check_in: choosing });
          }}
          onEdit={(trip) => {
            setTripDialog(null);
            setEditor({ kind: 'trip', trip });
          }}
          onDelete={(trip) => {
            setTripDialog(null);
            setDeleteError('');
            setRemoval({ kind: 'trip', trip });
          }}
        />
      )}
      {detail_visit && detail_place && detail_trip && !editor && !removal && !open_photo && (
        <Dialog title="Check-in" onDismiss={() => setDetailId(null)} wide>
          <VisitCard
            visit={detail_visit}
            place={detail_place}
            trip={detail_trip}
            platform={platform}
            detail
            onOpen={() => {}}
            onPhoto={(asset) => setOpenPhoto({ asset, caption: detail_place.name })}
          />
          <footer className="dialog-footer detail-actions">
            <button
              className="secondary"
              onClick={() => {
                setDeleteError('');
                setRemoval({ kind: 'visit', visit: detail_visit });
              }}
            >
              <Icon name="trash" size={17} />
              Delete check-in
            </button>
            <button
              className="primary"
              onClick={() => setEditor({ kind: 'visit', trip: detail_trip, visit: detail_visit })}
            >
              <Icon name="edit" size={17} />
              Edit check-in
            </button>
          </footer>
        </Dialog>
      )}
      {editor?.kind === 'trip' && (
        <TripForm
          trip={editor.trip}
          onCancel={() => setEditor(null)}
          onSave={async (trip) => {
            await persist(upsertTrip(journal, trip));
            setSelectedTripId(trip.id);
            setEditor(editor.then_check_in ? { kind: 'visit', trip } : null);
          }}
        />
      )}
      {editor?.kind === 'visit' && (
        <CheckInForm
          trip={editor.trip}
          places={journal.places}
          check_in={editor.visit}
          platform={platform}
          onCancel={async (unused) => {
            await cleanPhotos(unused);
            setEditor(null);
          }}
          onSave={async (visit, place, unused) => {
            await persist(saveCheckIn(journal, visit, place));
            setEditor(null);
            await cleanPhotos(unused);
          }}
        />
      )}
      {removal && (
        <Dialog
          title={removal.kind === 'trip' ? 'Delete this trip?' : 'Delete this check-in?'}
          onDismiss={() => {
            if (!deleting) setRemoval(null);
          }}
        >
          <div className="form-body">
            <p>
              {removal.kind === 'trip'
                ? `“${removal.trip.title}” and all of its check-ins and photos will be removed. Saved named places will remain.`
                : 'This check-in, its notes, and its attached photos will be removed.'}
            </p>
            <p className="muted">This cannot be undone.</p>
            {delete_error && (
              <p role="alert" className="form-error">
                {delete_error}
              </p>
            )}
          </div>
          <footer className="dialog-footer">
            <button className="secondary" disabled={deleting} onClick={() => setRemoval(null)}>
              Keep it
            </button>
            <button className="danger" disabled={deleting} onClick={() => void deleteEntry()}>
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </footer>
        </Dialog>
      )}
      {open_photo && (
        <Dialog title={open_photo.caption} onDismiss={() => setOpenPhoto(null)} wide>
          <div className="lightbox">
            <Photo photo={open_photo.asset} platform={platform} alt={open_photo.caption} />
          </div>
        </Dialog>
      )}
    </div>
  );
}
