import { useEffect, useMemo, useState } from 'react';
import { directoryKey } from './directory-format';
import { sameDirectoryPlace } from './planned-stop-search';
import {
  filterNearbyPlaces,
  type StopLookup,
  type StopSearchRequest,
  type StopSearchResult,
} from './stop-lookup';

type SearchResponse =
  | { places: StopSearchResult[]; error?: never }
  | { places?: never; error: string };

function usePlaceRequest(
  lookup: StopLookup,
  request: StopSearchRequest | null,
  enabled: boolean,
  attempt: number,
) {
  const [result, setResult] = useState<{
    request: StopSearchRequest;
    attempt: number;
    response: SearchResponse;
  }>();
  useEffect(() => {
    if (!enabled || !request) return;
    const controller = new AbortController();
    const { signal } = controller;
    void Promise.resolve().then(async () => {
      if (signal.aborted) return;
      let response: SearchResponse;
      try {
        response = { places: await lookup.search(request, signal) };
      } catch (reason) {
        response = {
          error: reason instanceof Error ? reason.message : 'Search failed. Please try again.',
        };
      }
      if (!signal.aborted) setResult({ request, attempt, response });
    });
    return () => controller.abort();
  }, [lookup, request, enabled, attempt]);
  return result && result.request === request && result.attempt === attempt
    ? result.response
    : undefined;
}

export function usePlaceSuggestions(
  lookup: StopLookup,
  scope: Omit<StopSearchRequest, 'query'>,
  query: string,
  submitted: string | null,
  can_browse: boolean,
  active: boolean,
  composing: boolean,
) {
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<{ scope: typeof scope; term: string }>();
  const airports = scope.category === 'airport';
  const term = query.trim();
  const live =
    submitted === null &&
    !composing &&
    (airports
      ? Boolean(term)
      : Boolean(scope.city) &&
        (scope.category === 'sight' || scope.category === 'stay') &&
        /[\p{L}\p{N}].*[\p{L}\p{N}]/u.test(term));
  useEffect(() => {
    if (!active || !live || airports) return;
    const timer = window.setTimeout(() => setSettled({ scope, term }), 500);
    return () => window.clearTimeout(timer);
  }, [active, live, airports, scope, term]);
  const ready = live && (airports || (settled?.scope === scope && settled.term === term));
  const name = submitted || (ready ? term : '');
  // Photon uses the same endpoint for both actions. Return can finish a pending lookup.
  const autocomplete = Boolean(name && live && !airports && lookup.attribution === 'Geoapify');
  const named_request = useMemo(
    () => (name ? { ...scope, query: name, suggest: autocomplete } : null),
    [scope, name, autocomplete],
  );
  const nearby_request = useMemo(
    () => (can_browse ? { ...scope, query: '' } : null),
    [scope, can_browse],
  );
  const nearby = usePlaceRequest(lookup, nearby_request, active && !submitted, name ? 0 : attempt);
  const named = usePlaceRequest(lookup, named_request, active, name ? attempt : 0);
  // Keep the names already on screen in place as wider suggestions arrive. A street
  // address alone (e.g. "National Highway" for "Nara National") is a poor name hint.
  let places = name ? named?.places : nearby?.places;
  if (submitted === null && can_browse && nearby?.places) {
    const phrase = directoryKey(term);
    const local =
      live && !named?.error
        ? nearby.places.filter((place) => directoryKey(place.title).includes(phrase))
        : filterNearbyPlaces(nearby.places, term);
    places = named?.places
      ? [
          ...local,
          ...named.places.filter(
            (place) =>
              !local.some((row) => sameDirectoryPlace({ ...row, provider: row.source }, place)),
          ),
        ]
      : local;
  }
  return {
    places,
    filter_nearby: submitted === null && can_browse && !named?.places,
    named_term: named?.places ? name : '',
    searching_name: Boolean(name || live),
    loading: name || live ? !named : Boolean(nearby_request && !nearby),
    has_request: Boolean(name || live || nearby_request),
    error: named?.error ?? (!name && !live ? nearby?.error : undefined),
    retry: () => setAttempt((previous) => previous + 1),
  };
}
