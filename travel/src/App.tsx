import { useEffect, useState } from 'react';
import { createPlatform } from './lib/platform';
import {
  emptyJournal,
  formatCoordinates,
  removeCheckIn,
  removeTrip,
  saveCheckIn,
  upsertTrip,
} from './lib/model';
import { formatTripDates, formatVisitDate, formatVisitTime } from './lib/dates';
import type { CheckIn, Journal, PhotoAsset, Place, TravelPlatform, Trip } from './lib/types';
import { Icon } from './components/Icon';
import { Dialog } from './components/Dialog';
import { TripForm } from './components/TripForm';
import { CheckInForm } from './components/CheckInForm';
import { Photo } from './components/Photo';

type Editor = { kind: 'trip'; trip?: Trip } | { kind: 'visit'; trip: Trip; visit?: CheckIn } | null;
type Removal = { kind: 'trip'; trip: Trip } | { kind: 'visit'; visit: CheckIn } | null;
type View = 'journal' | 'places' | 'photos';
type OpenPhoto = { asset: PhotoAsset; caption: string } | null;

export function App() {
  const [platform, setPlatform] = useState<TravelPlatform | null>(null);
  const [journal, setJournal] = useState<Journal>(emptyJournal);
  const [loading, setLoading] = useState(true);
  const [load_error, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState('');
  const [selected_trip_id, setSelectedTripId] = useState<string | null>(null);
  const [selected_place_id, setSelectedPlaceId] = useState<string | null>(null);
  const [view, setView] = useState<View>('journal');
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<Editor>(null);
  const [removal, setRemoval] = useState<Removal>(null);
  const [deleting, setDeleting] = useState(false);
  const [delete_error, setDeleteError] = useState('');
  const [open_photo, setOpenPhoto] = useState<OpenPhoto>(null);

  useEffect(() => {
    let live = true;
    setLoading(true);
    setLoadError('');
    createPlatform()
      .then(async (next_platform) => {
        const data = await next_platform.load();
        if (live) {
          setPlatform(next_platform);
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
  const selected_place = journal.places.find((place) => place.id === selected_place_id);
  const places = new Map(journal.places.map((place) => [place.id, place]));
  const trips = new Map(journal.trips.map((trip) => [trip.id, trip]));
  const all_photos = journal.check_ins.flatMap((visit) =>
    visit.photos.map((asset) => ({ asset, visit })),
  );
  const visits = journal.check_ins
    .filter((visit) => {
      if (selected_trip && visit.trip_id !== selected_trip.id) return false;
      if (selected_place && visit.place_id !== selected_place.id) return false;
      const place = places.get(visit.place_id)!;
      return `${place.name} ${place.locality} ${visit.notes}`
        .toLocaleLowerCase()
        .includes(search.toLocaleLowerCase());
    })
    .sort((a, b) => a.visited_at.localeCompare(b.visited_at) || a.id.localeCompare(b.id));

  function navigate(next: View, trip_id: string | null = null, place_id: string | null = null) {
    setView(next);
    setSelectedTripId(trip_id);
    setSelectedPlaceId(place_id);
    setSearch('');
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
    if (!removal) return;
    setDeleting(true);
    setDeleteError('');
    try {
      const assets =
        removal.kind === 'visit'
          ? removal.visit.photos
          : journal.check_ins
              .filter((visit) => visit.trip_id === removal.trip.id)
              .flatMap((visit) => visit.photos);
      const next =
        removal.kind === 'trip'
          ? removeTrip(journal, removal.trip.id)
          : removeCheckIn(journal, removal.visit.id);
      await persist(next);
      if (removal.kind === 'trip') navigate('journal');
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
          <Icon name="compass" size={32} />
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
    <div className="app-shell">
      <aside className="sidebar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            navigate('journal');
          }}
        >
          <span className="brand-symbol">
            <Icon name="compass" size={28} />
          </span>
          <span>
            Fieldnotes<small>A personal travel journal</small>
          </span>
        </a>
        <nav className="main-nav" aria-label="Journal">
          <button
            className={view === 'journal' ? 'active' : ''}
            onClick={() => navigate('journal')}
          >
            <Icon name="book" />
            My journeys<span>{journal.trips.length}</span>
          </button>
          <button className={view === 'places' ? 'active' : ''} onClick={() => navigate('places')}>
            <Icon name="pin" />
            Places<span>{journal.places.length}</span>
          </button>
          <button className={view === 'photos' ? 'active' : ''} onClick={() => navigate('photos')}>
            <Icon name="photo" />
            Photos<span>{all_photos.length}</span>
          </button>
        </nav>
        <div className="sidebar-trips">
          <div className="sidebar-label">
            YOUR TRIPS
            <button
              className="icon-button"
              aria-label="Create trip"
              onClick={() => setEditor({ kind: 'trip' })}
            >
              <Icon name="plus" size={17} />
            </button>
          </div>
          {journal.trips.length === 0 ? (
            <p className="sidebar-hint">Every journey starts with a first page.</p>
          ) : (
            journal.trips.map((trip, index) => (
              <button
                key={trip.id}
                className={`trip-link ${selected_trip_id === trip.id ? 'selected' : ''}`}
                onClick={() => navigate('journal', trip.id)}
              >
                <span className={`trip-dot tone-${index % 4}`} />
                <span>{trip.title}</span>
              </button>
            ))
          )}
        </div>
        <div className="sidebar-foot">
          <span className="small-compass">✳</span>
          <p>
            Collect moments.
            <br />
            Remember the places.
          </p>
          <small>Stored on this device</small>
        </div>
      </aside>
      <main>
        <div className="topline">
          <span>THE TRAVEL JOURNAL</span>
          <span className="local-label">
            <span />
            YOUR STORIES, KEPT CLOSE
          </span>
        </div>
        {notice && (
          <div className="notice" role="status">
            {notice}
            <button
              className="icon-button"
              aria-label="Dismiss notice"
              onClick={() => setNotice('')}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        {view === 'journal' && !selected_trip && !selected_place && (
          <>
            <header className="page-heading">
              <div>
                <p className="eyebrow">A LITTLE FURTHER, A LITTLE CLOSER</p>
                <h1>
                  Places pass.
                  <br />
                  <em>Memories stay.</em>
                </h1>
                <p className="lede">
                  The places you found. The moments you kept.
                  <br />A journal for everywhere life takes you.
                </p>
              </div>
              <button className="primary" onClick={() => setEditor({ kind: 'trip' })}>
                <Icon name="plus" size={18} />
                New trip
              </button>
            </header>
            <div className="overview-strip">
              <Stat value={journal.trips.length} label="journeys" />
              <Stat value={journal.check_ins.length} label="check-ins" />
              <Stat
                value={new Set(journal.check_ins.map((visit) => visit.place_id)).size}
                label="places visited"
              />
              <Stat value={all_photos.length} label="photos kept" />
            </div>
            <section className="journeys">
              <div className="section-title">
                <h2>Your journeys</h2>
                <span>{journal.trips.length.toString().padStart(2, '0')} CHAPTERS</span>
              </div>
              {journal.trips.length === 0 ? (
                <div className="empty-journal">
                  <div className="postmark">
                    <Icon name="compass" size={46} />
                    <span>
                      GO SOMEWHERE
                      <br />
                      REMEMBER SOMETHING
                    </span>
                  </div>
                  <h2>Your next story starts here.</h2>
                  <p>Create a trip, check in at a place, and keep a photo of the moment.</p>
                  <button className="text-button" onClick={() => setEditor({ kind: 'trip' })}>
                    Start your first journey
                    <Icon name="arrow" size={18} />
                  </button>
                </div>
              ) : (
                <div className="trip-grid">
                  {journal.trips.map((trip, index) => {
                    const entries = journal.check_ins.filter((visit) => visit.trip_id === trip.id);
                    const cover = entries.flatMap((visit) => visit.photos)[0];
                    return (
                      <button
                        className={`trip-card tone-${index % 4}`}
                        key={trip.id}
                        onClick={() => navigate('journal', trip.id)}
                      >
                        <div className="trip-cover">
                          {cover ? (
                            <Photo photo={cover} platform={platform} alt={trip.title} />
                          ) : (
                            <div className="cover-art">
                              <Icon name="compass" size={70} />
                              <span>JOURNEY {String(index + 1).padStart(2, '0')}</span>
                            </div>
                          )}
                          <span className="cover-tag">{entries.length} CHECK-INS</span>
                        </div>
                        <div className="trip-card-body">
                          <span className="trip-date">
                            {formatTripDates(trip.start_date, trip.end_date)}
                          </span>
                          <h3>{trip.title}</h3>
                          <p>{trip.description || 'A story waiting to unfold.'}</p>
                          <div>
                            <span>
                              {new Set(entries.map((visit) => visit.place_id)).size} places explored
                            </span>
                            <Icon name="arrow" size={19} />
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
        {((view === 'journal' && selected_trip) || (view === 'places' && selected_place)) && (
          <>
            <button
              className="back-link"
              onClick={() => navigate(selected_place ? 'places' : 'journal')}
            >
              ← {selected_place ? 'All places' : 'All journeys'}
            </button>
            <header className="page-heading detail-heading">
              <div>
                <p className="eyebrow">
                  {selected_place
                    ? 'ONE PLACE, MANY MOMENTS'
                    : formatTripDates(selected_trip!.start_date, selected_trip!.end_date)}
                </p>
                <h1>{selected_trip?.title ?? selected_place?.name}</h1>
                <p className="lede">
                  {selected_trip?.description ||
                    selected_place?.locality ||
                    'Make room for a few good memories.'}
                </p>
              </div>
              <div className="button-row">
                {selected_trip && (
                  <>
                    <button
                      className="icon-button"
                      aria-label="Edit trip"
                      onClick={() => setEditor({ kind: 'trip', trip: selected_trip })}
                    >
                      <Icon name="edit" />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Delete trip"
                      onClick={() => {
                        setDeleteError('');
                        setRemoval({ kind: 'trip', trip: selected_trip });
                      }}
                    >
                      <Icon name="trash" />
                    </button>
                    <button
                      className="primary"
                      onClick={() => setEditor({ kind: 'visit', trip: selected_trip })}
                    >
                      <Icon name="plus" size={18} />
                      Check in <span className="chinese">打卡</span>
                    </button>
                  </>
                )}
              </div>
            </header>
            <div className="timeline-toolbar">
              <h2>The moments along the way</h2>
              <label className="search-box">
                <Icon name="search" size={17} />
                <input
                  aria-label="Search check-ins"
                  placeholder="Find a moment…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
            </div>
            {visits.length === 0 ? (
              <Empty
                icon="pin"
                title={search ? 'No matching moments.' : 'You’re here. Remember it.'}
                text={
                  search
                    ? 'Try another place name or a word from your notes.'
                    : 'Your check-ins will appear here, from the first stop to the last.'
                }
              />
            ) : (
              <div className="timeline">
                {visits.map((visit, index) => (
                  <VisitCard
                    key={visit.id}
                    visit={visit}
                    place={places.get(visit.place_id)!}
                    trip={trips.get(visit.trip_id)!}
                    platform={platform}
                    index={index}
                    show_trip={Boolean(selected_place)}
                    onEdit={() =>
                      setEditor({ kind: 'visit', trip: trips.get(visit.trip_id)!, visit })
                    }
                    onDelete={() => {
                      setDeleteError('');
                      setRemoval({ kind: 'visit', visit });
                    }}
                    onPhoto={(asset) =>
                      setOpenPhoto({ asset, caption: places.get(visit.place_id)!.name })
                    }
                  />
                ))}
              </div>
            )}
          </>
        )}
        {view === 'places' && !selected_place && (
          <>
            <header className="page-heading">
              <div>
                <p className="eyebrow">FAMILIAR NAMES, PERSONAL STORIES</p>
                <h1>
                  A world of <em>places.</em>
                </h1>
                <p className="lede">One named place can hold many different visits.</p>
              </div>
            </header>
            {journal.places.length === 0 ? (
              <Empty
                icon="pin"
                title="Put a place in your story."
                text="Named places are saved when you add a check-in to a trip."
              />
            ) : (
              <div className="place-grid">
                {journal.places.map((place) => (
                  <button
                    className="place-card"
                    key={place.id}
                    onClick={() => navigate('places', null, place.id)}
                  >
                    <span className="place-mark">
                      <Icon name="pin" size={25} />
                    </span>
                    <h2>{place.name}</h2>
                    <p>{place.locality || 'A place to remember'}</p>
                    <span className="coordinate-text">
                      {place.position
                        ? formatCoordinates(place.position)
                        : 'No reference coordinates'}
                    </span>
                    <footer>
                      <span>
                        {journal.check_ins.filter((visit) => visit.place_id === place.id).length}{' '}
                        visits
                      </span>
                      <Icon name="arrow" size={18} />
                    </footer>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {view === 'photos' && (
          <>
            <header className="page-heading">
              <div>
                <p className="eyebrow">LITTLE WINDOWS INTO THEN</p>
                <h1>
                  Through <em>your eyes.</em>
                </h1>
                <p className="lede">The moments you brought home.</p>
              </div>
              <span className="count-label">{all_photos.length} PHOTOS</span>
            </header>
            {all_photos.length === 0 ? (
              <Empty
                icon="camera"
                title="Some moments deserve a photo."
                text="Take a photo or attach one from your library when you check in."
              />
            ) : (
              <div className="photo-gallery">
                {all_photos.map(({ asset, visit }) => (
                  <figure key={asset.id}>
                    <Photo
                      photo={asset}
                      platform={platform}
                      alt={places.get(visit.place_id)!.name}
                      onOpen={() =>
                        setOpenPhoto({ asset, caption: places.get(visit.place_id)!.name })
                      }
                    />
                    <figcaption>
                      <strong>{places.get(visit.place_id)!.name}</strong>
                      <span>{formatVisitDate(visit.visited_at, visit.utc_offset_minutes)}</span>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </>
        )}
        <footer className="page-footer">
          <span>FIELDNOTES</span>
          <span>Every place has a story. This one is yours.</span>
        </footer>
      </main>
      {editor?.kind === 'trip' && (
        <TripForm
          trip={editor.trip}
          onCancel={() => setEditor(null)}
          onSave={async (trip) => {
            await persist(upsertTrip(journal, trip));
            setEditor(null);
            navigate('journal', trip.id);
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
          title={removal.kind === 'trip' ? 'Delete this journey?' : 'Delete this check-in?'}
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

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="stat">
      <strong>{String(value).padStart(2, '0')}</strong>
      <span>{label}</span>
    </div>
  );
}

function Empty({ icon, title, text }: { icon: 'pin' | 'camera'; title: string; text: string }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={32} />
      </span>
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}

function VisitCard({
  visit,
  place,
  trip,
  platform,
  index,
  show_trip,
  onEdit,
  onDelete,
  onPhoto,
}: {
  visit: CheckIn;
  place: Place;
  trip: Trip;
  platform: TravelPlatform;
  index: number;
  show_trip: boolean;
  onEdit(): void;
  onDelete(): void;
  onPhoto(photo: PhotoAsset): void;
}) {
  return (
    <article className="visit-card">
      <div className="timeline-stop">
        <span>{String(index + 1).padStart(2, '0')}</span>
      </div>
      <div className="visit-content">
        <header>
          <div>
            <p className="visit-date">
              {formatVisitDate(visit.visited_at, visit.utc_offset_minutes)} <span>·</span>{' '}
              {formatVisitTime(visit.visited_at, visit.utc_offset_minutes)}
              {show_trip && (
                <>
                  {' '}
                  <span>·</span> {trip.title}
                </>
              )}
            </p>
            <h3>{place.name}</h3>
            {place.locality && <p className="muted locality">{place.locality}</p>}
          </div>
          <div className="button-row">
            <button
              className="icon-button"
              aria-label={`Edit check-in at ${place.name}`}
              onClick={onEdit}
            >
              <Icon name="edit" size={17} />
            </button>
            <button
              className="icon-button"
              aria-label={`Delete check-in at ${place.name}`}
              onClick={onDelete}
            >
              <Icon name="trash" size={17} />
            </button>
          </div>
        </header>
        {visit.notes && <p className="visit-notes">{visit.notes}</p>}
        {visit.photos.length > 0 && (
          <div className="visit-photos">
            {visit.photos.map((photo, i) => (
              <Photo
                key={photo.id}
                photo={photo}
                platform={platform}
                alt={`${place.name}, photo ${i + 1}`}
                onOpen={() => onPhoto(photo)}
              />
            ))}
          </div>
        )}
        <div className="location-pair">
          <div>
            <Icon name="locate" size={17} />
            <span>
              <small>ACTUAL VISIT</small>
              {visit.actual_location
                ? formatCoordinates(visit.actual_location)
                : 'Location not recorded'}
              {visit.actual_location && (
                <em>
                  {visit.actual_location.source === 'device'
                    ? `Device GPS${visit.actual_location.accuracy_m !== null ? ` · ±${Math.round(visit.actual_location.accuracy_m)} m` : ''}`
                    : 'Entered manually'}
                </em>
              )}
            </span>
          </div>
          <div>
            <Icon name="pin" size={17} />
            <span>
              <small>NAMED PLACE</small>
              {place.name}
              {place.position && <em>{formatCoordinates(place.position)}</em>}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}
