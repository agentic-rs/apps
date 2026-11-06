# Fieldnotes for Apell

A personal travel journal. Create a trip, check in (打卡) at a place, and attach the photos and notes you want to remember. Journeys show visits in chronological order; Places gathers repeat visits across trips; Photos collects attached images.

Each check-in keeps two separate locations:

- **Actual visit:** the coordinates where the event happened, optionally captured from foreground GPS or entered manually. Device fixes retain their capture time and accuracy. Unknown coordinates stay empty.
- **Named place:** a reusable place such as “West Lake / 西湖,” with an optional city/area and standard reference coordinates. Several visits can share this place while retaining their own actual coordinates. Editing a shared place updates its label/reference for all visits.

Place names are entered manually in this version. Coordinates use WGS84. There is no online place search, basemap, background tracking, automatic EXIF extraction, or cloud account. The app never substitutes a place’s reference position for the actual visit location. For a past visit, enter the position where it happened; **Use current location** always measures where the device is now.

## Develop

Requires Bun and a compatible Apell checkout. From this directory:

```sh
bun run setup
bun run dev
```

Setup links the local `@apell/sdk` through an ignored `.apell-sdk` symlink, then installs dependencies. It finds the sibling `apell` checkout from the primary Git directory, including when this app is developed in a linked worktree. To select another checkout, set `APELL_SDK_DIR` to its `packages/applet-sdk` directory before running setup. No machine-specific paths are stored in source or the lockfile.

The development server binds to loopback only. Browser preview uses IndexedDB for metadata and original photo files; it supports the system file picker and foreground browser geolocation. The camera button uses the device’s image capture picker where supported, otherwise the ordinary file picker. Browser data is separate from the native applet.

## Package and install

```sh
bun run pack
```

This builds `artifacts/travel.apel` and `artifacts/travel.sha256` with the sibling host’s `target/debug/apell` packer. Set `APELL_BIN` to use another compatible packer. Install the package in Apell using **+ → Install from file**. The stable applet ID is `travel`; its display name is **Fieldnotes**.

The applet requests `fs`, `camera`, `photos`, and `location`, with no network permission. Camera, photo library, and location use the host’s existing iOS/Android APIs and permission prompts. Cancelling a sensor prompt leaves the draft intact. Desktop native sensor support depends on the host; manual coordinates and the browser preview remain available. No Apell host modifications are required.

## Editing and storage

- Trips have a name, optional date range, and description. Check-ins have a visit date/time, saved UTC offset, notes, and up to 20 photos of up to 32 MiB each.
- Visit times preserve the recorded local time even after the device changes time zones. Select the time zone in effect during a past visit, including any daylight-saving adjustment.
- Supported imports are JPEG, PNG, GIF, WebP, HEIC, HEIF, and AVIF. Originals are retained. Preview support depends on the browser/device codec; unsupported images display a clear fallback. Gallery images load near the viewport and release their object URLs offscreen.
- Drafts stay open after a failed save and can be retried. Closing a form with edits asks before discarding them. Save before closing/reloading the app; unsaved text is not recovered after termination. A crash during image import can leave an unreferenced private photo file.
- Native metadata is an atomically replaced JSON snapshot, limited to 16 MiB, with photos stored separately in the applet’s private image directory. Browser snapshots use IndexedDB transactions and reject stale writes from another tab. Corrupt metadata is reported without replacing it with an empty journal.
- Deletion requires confirmation. Photo cleanup runs after the metadata save succeeds. Deleting a trip removes its visits and photos but retains reusable named places. A cleanup failure leaves a notice and unused files; saved entries are not rolled back.
- This first version has no backup/export or synchronization. Clearing browser storage or removing native applet data can erase the journal. No data is uploaded by the app; a system photo picker may retrieve a cloud-backed photo selected by the user.

Generated packages, dependencies, screenshots, local SDK links, and environment files are excluded from Git. Test fixtures contain synthetic content only.

## Verification

```sh
bun run check
bun test
bun run format:check
bun run test:ui
bun run test:native
bun run pack
```

Browser checks use Firefox through Playwright. Install its Firefox runtime with `bunx playwright-core install firefox`, or set `FIREFOX_PATH` to an existing Playwright-compatible Firefox executable. These tests use disposable browser contexts and synthetic data on temporary loopback servers. They never control Chrome or access the real journal. Screenshots are saved under ignored `artifacts/qa`.

Unit tests cover domain validation, repeated visits, independent coordinates, time-zone boundaries, image ownership, atomic persistence, stale browser writes, failed-save retries, and safe image paths. The browser smoke checks cover create/edit/reopen/delete, photos, failed-save recovery, and desktop/mobile layouts. The native smoke exercises the production bundle in an opaque sandboxed iframe with the real SDK bridge and simulated native services.

Physical-device camera, photo-picker, and GPS behavior still require validation in Apell on iOS/Android. Simulated bridge checks do not replace that device verification.
