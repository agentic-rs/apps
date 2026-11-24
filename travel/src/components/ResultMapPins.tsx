import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Map as LeafletMap } from 'leaflet';
import { useBackLayer } from '../lib/back-navigation';
import type { DayPlaceResult, DaySearchArea } from '../lib/place-comparison';
import type { Coordinates } from '../lib/types';
import { useMapPinClusters } from '../lib/use-map-pin-clusters';
import { ResultMapChoices } from './ResultMapChoices';
import { Icon } from './Icon';
import {
  DayPlacePin,
  openPlacePopup,
  place_pin_anchor,
  PlaceMapButton,
  type DayPinGroup,
} from './PlaceMapPins';

const kind_icons = {
  sight: 'landmark',
  stay: 'bed',
  food: 'food',
  transport: 'route',
  other: 'pin',
} as const;

type Pin = { key: string; position: Coordinates; anchor_y: number } & (
  | { kind: 'result'; result: DayPlaceResult }
  | { kind: 'route'; group: DayPinGroup }
);

type Chooser = {
  keys: ReadonlySet<string>;
  section: Pin['kind'];
  focus_id?: string;
};
type Inspection = { position: Coordinates; labels: string[] };

function countLabel(count: number, kind: string) {
  return `${count} ${kind}${count === 1 ? '' : 's'}`;
}

export function ResultMapPins({
  map,
  zoom,
  results,
  day_groups,
  area,
  selected_id,
  onSelect,
  card_title,
  disabled,
}: {
  map: LeafletMap;
  zoom: number;
  results: readonly DayPlaceResult[];
  day_groups: readonly DayPinGroup[];
  area?: DaySearchArea;
  selected_id: string;
  onSelect(id: string): void;
  card_title: RefObject<HTMLHeadingElement | null>;
  disabled: boolean;
}) {
  const pins = useMemo(() => {
    const results_first: Pin[] = results.map((result) => ({
      kind: 'result',
      key: 'result:' + result.place.id,
      position: result.place.position,
      anchor_y: place_pin_anchor.result,
      result,
    }));
    const index = results.findIndex(({ place }) => place.id === selected_id);
    if (index > 0) results_first.unshift(...results_first.splice(index, 1));
    return results_first.concat(
      day_groups.map((group) => ({
        kind: 'route',
        key: 'route:' + group.key,
        position: group.position,
        anchor_y: place_pin_anchor.route,
        group,
      })),
    );
  }, [results, selected_id, day_groups]);
  const clusters = useMapPinClusters(map, pins, zoom, 44);

  const [chooser, setChooser] = useState<Chooser | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const return_to = useRef<{ element: HTMLElement | null; pin_key?: string } | null>(null);
  const popup_back = useRef(false);

  const result_choices = chooser
    ? results.filter(({ place }) => chooser.keys.has('result:' + place.id))
    : [];
  const route_choices = chooser
    ? day_groups
        .filter((group) => chooser.keys.has('route:' + group.key))
        .flatMap((group) =>
          group.points.map((point, index) => ({
            point,
            label: group.labels[index],
            number: group.numbers[index],
            origin: area?.id === point.id ? `Search near ${area.title}` : undefined,
          })),
        )
        .sort((a, b) => (a.number ?? Infinity) - (b.number ?? Infinity))
    : [];

  useLayoutEffect(() => {
    if (!inspection && !chooser && return_to.current) {
      const { element, pin_key } = return_to.current;
      const key =
        pin_key &&
        clusters.find((cluster) => cluster.groups.some((pin) => pin.key === pin_key))?.key;
      const target = element?.isConnected
        ? element
        : key
          ? map
              .getContainer()
              .querySelector<HTMLButtonElement>(`[data-map-pin-key="${CSS.escape(key)}"]`)
          : null;
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'nearest' });
      return_to.current = null;
    }
  }, [chooser, inspection, map, clusters]);

  useBackLayer(Boolean(inspection), () => {
    popup_back.current = true;
    map.closePopup();
  });
  useLayoutEffect(() => {
    if (!inspection) return;
    popup_back.current = false;
    const popup = openPlacePopup(map, inspection.position, inspection.labels);
    const close = popup
      .getElement()
      ?.querySelector<HTMLAnchorElement>('.leaflet-popup-close-button');
    const rememberBack = () => {
      popup_back.current = true;
    };
    const dismissed = () => {
      if (!popup_back.current) {
        // Fitting the map, changing results or tapping another pin supersedes this inspection.
        return_to.current = null;
        setChooser(null);
      }
      setInspection(null);
    };
    close?.addEventListener('click', rememberBack, true);
    close?.focus({ preventScroll: true });
    popup.on('remove', dismissed);
    return () => {
      popup.off('remove', dismissed);
      close?.removeEventListener('click', rememberBack, true);
      popup.remove();
    };
  }, [map, inspection]);

  return (
    <>
      {clusters.map(({ key, position, groups }) => {
        const first = groups[0];
        if (groups.length === 1 && first.kind === 'route' && first.group.points.length === 1) {
          return (
            <DayPlacePin
              key={key}
              marker_key={key}
              disabled={disabled}
              map={map}
              group={first.group}
              search_area={area}
              onOpen={(button, labels) => {
                map.closePopup();
                return_to.current = { element: button, pin_key: first.key };
                setInspection({ position, labels });
              }}
            />
          );
        }
        const result_pins = groups.filter((pin) => pin.kind === 'result');
        const route_pins = groups.filter((pin) => pin.kind === 'route');
        const route_labels = route_pins.flatMap((pin) => pin.group.labels);
        const counted = result_pins.length + route_labels.length > 1;
        const includes_origin =
          area && route_pins.some((pin) => pin.group.entry_ids.includes(area.id));
        const counts = [
          result_pins.length && countLabel(result_pins.length, 'map result'),
          route_labels.length && countLabel(route_labels.length, 'day route place'),
        ]
          .filter(Boolean)
          .join(' and ');
        const description = [
          ...result_pins.map((pin) => pin.result.place.title),
          ...route_labels,
          includes_origin && `Search near ${area.title}`,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <PlaceMapButton
            key={key}
            marker_key={key}
            map={map}
            kind={first.kind}
            position={position}
            label={
              counted ? `Choose from ${counts}` : `Show ${result_pins[0].result.place.title} on map`
            }
            description={counted ? description : undefined}
            selected={first.kind === 'result' && first.result.place.id === selected_id}
            opens_dialog={counted}
            disabled={disabled}
            numbers={route_pins.flatMap((pin) => pin.group.numbers).sort((a, b) => a - b)}
            onClick={(button) => {
              map.closePopup();
              if (counted) {
                return_to.current = { element: button, pin_key: first.key };
                setChooser({
                  keys: new Set(groups.map((pin) => pin.key)),
                  section: first.kind,
                  focus_id:
                    first.kind === 'result' ? first.result.place.id : first.group.points[0].id,
                });
              } else if (first.kind === 'result') {
                onSelect(first.result.place.id);
              }
            }}
          >
            {counted ? (
              <span
                className="browse-result-count"
                data-search-origin={includes_origin ? '' : undefined}
              >
                <Icon name="layers" size={13} />
                {result_pins.length + route_labels.length}
              </span>
            ) : first.kind === 'result' ? (
              <span className="browse-pin-badge">
                <Icon name={kind_icons[first.result.place.kind]} size={18} />
              </span>
            ) : null}
          </PlaceMapButton>
        );
      })}
      {chooser &&
        !inspection &&
        createPortal(
          <ResultMapChoices
            section={chooser.section}
            focus_id={chooser.focus_id}
            selected_id={selected_id}
            result_choices={result_choices}
            route_choices={route_choices}
            onSectionChange={(section) => setChooser({ ...chooser, section, focus_id: undefined })}
            onPick={(id) => {
              return_to.current = { element: card_title.current };
              onSelect(id);
              setChooser(null);
            }}
            onInspect={({ point, label, origin }) => {
              setChooser({ ...chooser, focus_id: point.id });
              setInspection({
                position: point.position,
                labels: origin ? [origin, label] : [label],
              });
            }}
            onClose={() => setChooser(null)}
          />,
          map.getContainer().closest('.app-shell') ?? document.body,
        )}
    </>
  );
}
