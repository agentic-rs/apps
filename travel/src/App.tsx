import { lazy, Suspense, useMemo, useState } from 'react';
import { useJournal } from './lib/useJournal';
import { currentOffsetMinutes, offsetDay, toVisitInput } from './lib/dates';
import {
  addPhotoEvents,
  moveStop,
  removeCheckIn,
  removeStop,
  removeTrip,
  saveCheckIn,
  upsertStop,
  upsertTrip,
  visitTitle,
} from './lib/model';
import type { CheckIn, PhotoAsset, PlannedStop, Trip } from './lib/types';
import { Icon } from './components/Icon';
import { Dialog } from './components/Dialog';
import { TripForm } from './components/TripForm';
import { NewTrip } from './components/NewTrip';
import { AddTripCity } from './components/AddTripCity';
import { sameTripCity, tripCitySummary } from './lib/cities';
import { createStopLookup, type StopSearchCategory } from './lib/stop-lookup';
import { citiesOnDay } from './lib/city-days';
import { continuingStays, isContinuingStay } from './lib/hotel-stays';
import { StopForm } from './components/StopForm';
import { CheckInForm } from './components/CheckInForm';
import { Photo } from './components/Photo';
import { PhotoEventsForm } from './components/PhotoEventsForm';
import { TimelineView } from './components/TimelineView';
import { TripLibrary } from './components/TripLibrary';
import { TripToolbox } from './components/TripToolbox';
import { RoutePlanner } from './components/RoutePlanner';
import { applyDayRoute } from './lib/route-planner';
import { TripDays } from './components/TripDays';
import { TripOverview } from './components/TripOverview';
import { ItineraryDay } from './components/ItineraryDay';
import { VisitCard } from './components/VisitCard';
import fieldnotes_icon from '../../shared/assets/fieldnotes.svg';

const MapView = lazy(() => import('./components/MapView'));

type View = 'Itinerary' | 'Map' | 'Journal' | 'Toolbox';
type Editor =
  | { kind: 'new_trip' | 'edit_trip' | 'add_city' | 'overview' }
  | { kind: 'stop'; stop?: PlannedStop; initial_category?: StopSearchCategory }
  | { kind: 'route' }
  | { kind: 'visit'; visit?: CheckIn; stop?: PlannedStop }
  | { kind: 'photo_events' };
type Removal =
  | { kind: 'trip'; trip: Trip }
  | { kind: 'stop'; stop: PlannedStop }
  | { kind: 'visit'; visit: CheckIn };
const views = { Itinerary: 'timeline', Map: 'map', Journal: 'book', Toolbox: 'toolbox' } as const;

function recordedDay(visit: CheckIn) {
  return toVisitInput(visit.visited_at, visit.utc_offset_minutes).slice(0, 10);
}

function localToday() {
  const now = new Date();
  return toVisitInput(now.toISOString(), currentOffsetMinutes(now)).slice(0, 10);
}

export function App() {
  const { platform, journal, load_error, retry, notice, setNotice, cleanPhotos, persist } =
    useJournal();
  const [trip_id, setTripId] = useState('');
  const [view, setView] = useState<View>('Itinerary');
  const [chosen_day, setChosenDay] = useState('');
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [detail_id, setDetailId] = useState('');
  const [open_photo, setOpenPhoto] = useState<{ asset: PhotoAsset; caption: string } | null>(null);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [delete_error, setDeleteError] = useState('');

  const trip = journal.trips.find((item) => item.id === trip_id);
  const lookup = useMemo(() => createStopLookup(Boolean(platform?.native)), [platform?.native]);
  const route_summary = trip && tripCitySummary(trip);
  const stops = useMemo(
    () => journal.stops.filter((stop) => stop.trip_id === trip_id),
    [journal.stops, trip_id],
  );
  const visits = useMemo(
    () =>
      journal.check_ins
        .filter((visit) => visit.trip_id === trip_id)
        .sort((a, b) => b.visited_at.localeCompare(a.visited_at) || a.id.localeCompare(b.id)),
    [journal.check_ins, trip_id],
  );
  const entry_days = useMemo(
    () =>
      [
        ...stops.flatMap((stop) =>
          stop.checkout_date ? [stop.day, stop.checkout_date] : [stop.day],
        ),
        ...visits.map(recordedDay),
      ].sort(),
    [stops, visits],
  );
  const today = localToday();
  const bounds = [
    trip?.start_date,
    trip?.end_date,
    entry_days[0],
    entry_days.at(-1),
    ...(trip?.city_arrival_dates ?? []),
  ]
    .filter((date): date is string => Boolean(date))
    .sort();
  const first = bounds[0] ?? today;
  const last = bounds.at(-1) ?? today;
  const day = chosen_day || (first <= today && today <= last ? today : first);
  const day_cities = trip && view === 'Itinerary' ? citiesOnDay(trip, day).join(' → ') : '';
  const day_stops = useMemo(() => stops.filter((stop) => stop.day === day), [stops, day]);
  const day_visits = useMemo(
    () => visits.filter((visit) => recordedDay(visit) === day),
    [visits, day],
  );
  const detail = visits.find((visit) => visit.id === detail_id);
  const place = journal.places.find((item) => item.id === detail?.place_id);
  const linked_stop = detail?.stop_id
    ? stops.find((stop) => stop.id === detail.stop_id)
    : undefined;

  function openTrip(id: string) {
    setTripId(id);
    setChosenDay('');
    setView('Itinerary');
    setSearch('');
    setNotice('');
    setDetailId('');
  }

  function updateTrip(id: string, update: (current: Trip) => Trip) {
    return persist((snapshot) => {
      const current = snapshot.trips.find((item) => item.id === id);
      if (!current) throw new Error('This trip has been removed.');
      return upsertTrip(snapshot, { ...update(current), updated_at: new Date().toISOString() });
    });
  }

  function reorderStop(stop: PlannedStop, direction: -1 | 1) {
    return persist((snapshot) => moveStop(snapshot, stop.id, direction));
  }

  function openItineraryDay(date: string) {
    setChosenDay(date);
    setView('Itinerary');
    setEditor(null);
  }

  function confirmRemoval(target: Removal) {
    setDeleteError('');
    setRemoval(target);
  }
  async function deleteEntry() {
    if (!removal || deleting) return;
    setDeleting(true);
    setDeleteError('');
    try {
      let photos: PhotoAsset[] = [];
      await persist((snapshot) => {
        if (removal.kind === 'stop') return removeStop(snapshot, removal.stop.id);
        if (removal.kind === 'trip') {
          photos = snapshot.check_ins
            .filter((item) => item.trip_id === removal.trip.id)
            .flatMap((item) => item.photos);
          return removeTrip(snapshot, removal.trip.id);
        }
        photos = snapshot.check_ins.find((item) => item.id === removal.visit.id)?.photos ?? [];
        return removeCheckIn(snapshot, removal.visit.id);
      });
      if (removal.kind === 'trip') openTrip('');
      setRemoval(null);
      setEditor(null);
      setDetailId('');
      await cleanPhotos(photos);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Could not delete this item.');
    } finally {
      setDeleting(false);
    }
  }

  if (!platform)
    return (
      <div className="startup">
        <img className="brand-symbol" src={fieldnotes_icon} alt="" />
        <h1>Fieldnotes</h1>
        {load_error ? (
          <>
            <p role="alert">{load_error}</p>
            <button className="primary" onClick={retry}>
              Try again
            </button>
          </>
        ) : (
          <p>Opening your trips…</p>
        )}
      </div>
    );

  const visit_editor = (stop?: PlannedStop) => setEditor({ kind: 'visit', stop });
  const show_photos = () => setEditor({ kind: 'photo_events' });
  const displayPhoto = (asset: PhotoAsset, caption: string) => setOpenPhoto({ asset, caption });
  return (
    <div className={`app-shell${platform.native ? ' native' : ''}`}>
      {(trip || !platform.native) && (
        <header className="view-header">
          {trip && (
            <button className="trip-back" onClick={() => openTrip('')}>
              <Icon name="back" size={15} />
              Trips
            </button>
          )}
          <div className="view-title">
            {!trip && <img className="brand-symbol" src={fieldnotes_icon} alt="" />}
            {trip ? (
              <div className="trip-header-copy">
                <h1>{trip.title}</h1>
                {route_summary && route_summary !== day_cities && <p>{route_summary}</p>}
              </div>
            ) : (
              <h1>Fieldnotes</h1>
            )}
          </div>
          {trip && view === 'Itinerary' && (
            <button className="trip-add-city" onClick={() => setEditor({ kind: 'add_city' })}>
              <Icon name="plus" size={15} />
              Add a city
            </button>
          )}
          {trip && (
            <button
              className="icon-button"
              aria-label="Edit trip"
              onClick={() => setEditor({ kind: 'edit_trip' })}
            >
              <Icon name="edit" size={19} />
            </button>
          )}
        </header>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
          <button className="icon-button" aria-label="Dismiss notice" onClick={() => setNotice('')}>
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
      <main className="app-content" key={trip_id}>
        {!trip ? (
          <div className="timeline-panel">
            <TripLibrary
              journal={journal}
              platform={platform}
              onOpen={(value) => openTrip(value.id)}
              onCreate={() => setEditor({ kind: 'new_trip' })}
            />
          </div>
        ) : view === 'Toolbox' ? (
          <div className="timeline-panel">
            <TripToolbox trip={trip} day={day} onChange={(update) => updateTrip(trip.id, update)} />
          </div>
        ) : view === 'Journal' ? (
          <div className="timeline-panel">
            <div className="trip-journal-heading">
              <h2>Trip journal</h2>
              <div className="button-row">
                <button className="secondary" onClick={() => visit_editor()}>
                  <Icon name="pin" size={16} />
                  New check-in
                </button>
                <button className="secondary" onClick={show_photos}>
                  <Icon name="photo" size={16} />
                  Events from photos
                </button>
              </div>
            </div>
            <TimelineView
              visits={visits}
              places={journal.places}
              trip={trip}
              platform={platform}
              search={search}
              onSearch={setSearch}
              onOpenVisit={setDetailId}
              onPhoto={displayPhoto}
            />
          </div>
        ) : (
          <div className="daily-workspace">
            <TripDays
              trip={trip}
              first={first}
              last={last}
              day={day}
              onSelect={setChosenDay}
              onOverview={() => setEditor({ kind: 'overview' })}
            />
            {view === 'Itinerary' ? (
              <div className="daily-scroll" key={day}>
                <ItineraryDay
                  day={day}
                  day_cities={day_cities}
                  trip={trip}
                  stops={day_stops}
                  continuing_stays={continuingStays(stops, day)}
                  visits={day_visits}
                  trip_visits={visits}
                  places={journal.places}
                  platform={platform}
                  onAddStop={(initial_category) => setEditor({ kind: 'stop', initial_category })}
                  onOpenMap={() => setView('Map')}
                  onEditStop={(stop) => setEditor({ kind: 'stop', stop })}
                  onMoveStop={reorderStop}
                  onCheckIn={visit_editor}
                  onPhotoEvents={show_photos}
                  onOpenVisit={setDetailId}
                  onPhoto={displayPhoto}
                />
              </div>
            ) : (
              <div className="map-panel">
                <Suspense
                  fallback={
                    <p className="map-loading" role="status">
                      Opening map…
                    </p>
                  }
                >
                  <MapView
                    stops={day_stops}
                    visits={day_visits}
                    places={journal.places}
                    platform={platform}
                    active
                    onMoveStop={reorderStop}
                    onOptimize={() => setEditor({ kind: 'route' })}
                    onOpenVisit={setDetailId}
                    onOpenStop={(id) => {
                      const stop = stops.find((item) => item.id === id);
                      if (stop) setEditor({ kind: 'stop', stop });
                    }}
                  />
                </Suspense>
              </div>
            )}
          </div>
        )}
      </main>
      {trip && (
        <footer className="bottom-bar">
          <nav aria-label="Main views">
            {(Object.keys(views) as View[]).map((tab) => (
              <button
                key={tab}
                aria-current={view === tab ? 'page' : undefined}
                onClick={() => setView(tab)}
              >
                <Icon name={views[tab]} size={20} />
                {tab}
              </button>
            ))}
          </nav>
        </footer>
      )}
      {detail && trip && !editor && !removal && !open_photo && (
        <Dialog title={detail.title ? 'Event' : 'Check-in'} onDismiss={() => setDetailId('')} wide>
          <VisitCard
            visit={detail}
            place={place}
            trip={trip}
            platform={platform}
            detail
            onOpen={() => {}}
            onPhoto={(asset) => displayPhoto(asset, visitTitle(detail, place))}
          />
          {linked_stop && (
            <button
              className="linked-stop-button"
              onClick={() => {
                setDetailId('');
                setChosenDay(linked_stop.day);
                setView('Itinerary');
                setEditor({ kind: 'stop', stop: linked_stop });
              }}
            >
              <Icon name="timeline" size={17} />
              Planned stop · {linked_stop.title} · {linked_stop.day}
              <Icon name="arrow" size={15} />
            </button>
          )}
          <footer className="dialog-footer detail-actions">
            <button
              className="secondary"
              onClick={() => confirmRemoval({ kind: 'visit', visit: detail })}
            >
              <Icon name="trash" size={17} />
              Delete {detail.title ? 'event' : 'check-in'}
            </button>
            <button className="primary" onClick={() => setEditor({ kind: 'visit', visit: detail })}>
              <Icon name="edit" size={17} />
              Edit {detail.title ? 'event' : 'check-in'}
            </button>
          </footer>
        </Dialog>
      )}
      {editor?.kind === 'new_trip' && (
        <NewTrip
          onCancel={() => setEditor(null)}
          onSave={async (value) => {
            await persist((snapshot) => upsertTrip(snapshot, value));
            openTrip(value.id);
            setEditor(null);
          }}
        />
      )}
      {editor?.kind === 'edit_trip' && trip && (
        <TripForm
          trip={trip}
          onCancel={() => setEditor(null)}
          onDelete={() => confirmRemoval({ kind: 'trip', trip })}
          onSave={async (value) => {
            await updateTrip(trip.id, (current) => ({ ...current, ...value }));
            setEditor(null);
          }}
        />
      )}
      {editor?.kind === 'add_city' && trip && (
        <AddTripCity
          trip={trip}
          day={day}
          first_open_day={!bounds.length ? day : undefined}
          onCancel={() => setEditor(null)}
          onSave={async (city, arrival_date, location) => {
            await updateTrip(trip.id, (current) => {
              const cities = current.cities ?? [];
              if (
                sameTripCity(cities.at(-1) ?? '', current.city_locations?.at(-1), city, location)
              ) {
                throw new Error('This city is already last on your route.');
              }
              const dates = current.city_arrival_dates ?? cities.map(() => '');
              return {
                ...current,
                cities: [...cities, city],
                ...((current.city_locations || location) && {
                  city_locations: [
                    ...(current.city_locations ?? cities.map(() => null)),
                    location ?? null,
                  ],
                }),
                city_arrival_dates: [...dates, arrival_date],
                start_date:
                  !current.start_date && !bounds.length && arrival_date > day
                    ? day
                    : current.start_date,
                end_date:
                  current.end_date && arrival_date > current.end_date
                    ? arrival_date
                    : current.end_date,
              };
            });
            if (arrival_date) setChosenDay(arrival_date);
            setEditor(null);
          }}
        />
      )}
      {editor?.kind === 'overview' && trip && (
        <TripOverview
          trip={trip}
          day={day}
          first={first}
          last={last}
          stops={stops}
          onSelect={openItineraryDay}
          onDismiss={() => setEditor(null)}
          onAddDay={async () => {
            const next = offsetDay(last > day ? last : day, 1);
            await updateTrip(trip.id, (current) => ({
              ...current,
              start_date: current.start_date || (first < day ? first : day),
              end_date: next,
            }));
            openItineraryDay(next);
          }}
        />
      )}
      {editor?.kind === 'route' && trip && (
        <RoutePlanner
          stops={day_stops}
          onClose={() => setEditor(null)}
          onApply={async (original_ids, ordered_ids) => {
            await persist((snapshot) =>
              applyDayRoute(snapshot, trip.id, day, original_ids, ordered_ids),
            );
            setNotice('Day route updated.');
          }}
        />
      )}
      {editor?.kind === 'stop' && trip && (
        <StopForm
          lookup={lookup}
          trip_stops={stops}
          trip={trip}
          day={day}
          stop={editor.stop}
          initial_category={editor.initial_category}
          onCancel={() => setEditor(null)}
          onDelete={(stop) => confirmRemoval({ kind: 'stop', stop })}
          onSave={async (stop) => {
            await persist((snapshot) => upsertStop(snapshot, stop));
            if (!editor.stop || editor.stop.day === day || !isContinuingStay(stop, day))
              setChosenDay(stop.day);
            setEditor(null);
          }}
        />
      )}
      {editor?.kind === 'visit' && trip && (
        <CheckInForm
          trip={trip}
          places={journal.places}
          check_in={editor.visit}
          stop={editor.stop}
          day={day}
          stops={stops}
          platform={platform}
          onCancel={async (unused) => {
            await cleanPhotos(unused);
            setEditor(null);
          }}
          onSave={async (visit, place, unused) => {
            await persist((snapshot) => saveCheckIn(snapshot, visit, place));
            setChosenDay(recordedDay(visit));
            setEditor(null);
            await cleanPhotos(unused);
          }}
        />
      )}
      {editor?.kind === 'photo_events' && trip && (
        <PhotoEventsForm
          trip={trip}
          platform={platform}
          onCancel={async (photos) => {
            await cleanPhotos(photos);
            setEditor(null);
          }}
          onSave={async (events, unused) => {
            await persist((snapshot) => addPhotoEvents(snapshot, events));
            setChosenDay(recordedDay(events[0]));
            setView('Itinerary');
            setEditor(null);
            setNotice(
              `Saved ${events.length} ${events.length === 1 ? 'event' : 'events'} to ${trip.title}.`,
            );
            await cleanPhotos(unused);
          }}
        />
      )}
      {removal && (
        <Dialog
          title={`Delete this ${removal.kind === 'visit' ? (removal.visit.title ? 'event' : 'check-in') : removal.kind}?`}
          onDismiss={() => {
            if (!deleting) setRemoval(null);
          }}
        >
          <div className="form-body">
            <p>
              {removal.kind === 'trip'
                ? `“${removal.trip.title}”, its planned stops, journal entries and photos will be deleted.`
                : removal.kind === 'stop'
                  ? `Remove “${removal.stop.title}” from the plan? Its check-ins and photos will stay in the trip journal.`
                  : 'This journal entry and its photos will be deleted.'}
            </p>
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
