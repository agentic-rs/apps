/** The opaque Apell frame uses the host HTTP capability for external requests. */
export async function requestPlaceJson(
  url: URL,
  signal: AbortSignal,
  native: boolean,
  purpose: 'search' | 'details' = 'search',
  form?: URLSearchParams,
): Promise<unknown> {
  signal.throwIfAborted();
  let status: number;
  let body: string;
  try {
    if (native) {
      const { http } = await import('@apell/sdk');
      signal.throwIfAborted();
      const headers = [{ name: 'Accept', value: 'application/json' }];
      if (form) {
        headers.push(
          { name: 'Content-Type', value: 'application/x-www-form-urlencoded' },
          { name: 'User-Agent', value: 'Fieldnotes (https://github.com/agentic-rs/apps)' },
        );
      }
      const response = await http.request({
        url: url.href,
        timeout_ms: 12_000,
        headers,
        ...(form && {
          method: 'POST',
          body: Array.from(new TextEncoder().encode(form.toString())),
        }),
      });
      status = response.status;
      body = new TextDecoder().decode(Uint8Array.from(response.body));
    } else {
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
        referrerPolicy: 'no-referrer',
        credentials: 'omit',
        ...(form && { method: 'POST', body: form }),
      });
      status = response.status;
      body = await response.text();
    }
  } catch {
    signal.throwIfAborted();
    throw new Error(
      purpose === 'search'
        ? 'Could not reach place search. Check your connection or enter the stop manually.'
        : 'Could not load visitor details. Check your connection and try again.',
    );
  }
  signal.throwIfAborted();
  if (status === 429)
    throw new Error(
      purpose === 'search'
        ? 'Place search is busy. Try again shortly.'
        : 'Visitor details are busy. Try again shortly.',
    );
  if (status < 200 || status >= 300)
    throw new Error(
      purpose === 'search'
        ? 'The place service is unavailable. Try again or enter the stop manually.'
        : 'The visitor details service is unavailable. Try again.',
    );
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('The place service returned an unreadable result.');
  }
}
