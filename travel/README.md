# Fieldnotes for Apell

A mobile travel journal with two main views: **Timeline** and **Map**. The fixed bottom bar switches views and opens a menu for manual check-ins (打卡) and photo events. Timeline groups entries by their recorded local date, newest first. Map shows entries with coordinates. A shared trip filter applies to both views. Manage trips from the header and open any entry for its photos, notes, location details, editing, or deletion.

A single compact toolbar keeps the main view in focus. Inside Apell, the host owns device safe-area insets; standalone browser use adds its own. Search and the entry count share one row and appear once the selected timeline has entries.

Trip and check-in editors fill the applet screen, with a scrolling form and reachable save controls. Trips and the trip filter open beside their buttons and dismiss on an outside tap or Escape. Closing an edited draft still asks whether to discard it.

Each check-in keeps two separate locations:

- **Actual visit:** the coordinates where the event happened, optionally captured from foreground GPS or entered manually. Device fixes retain their capture time and accuracy. Unknown coordinates stay empty.
- **Named place:** a reusable place such as “West Lake / 西湖,” with an optional city/area and standard reference coordinates. Several visits can share this place while retaining their own actual coordinates. Editing a shared place updates its label/reference for all visits.

Place names are entered manually. Coordinates use WGS84. **Use current location** measures where the device is now.

## Events from photos

Open **+ → Events from photos**, choose a trip if prompted, and add pictures. The browser supports multiple selection. Apell’s native photo picker adds one original per selection. **Review events** shows the grouped pictures. Each starts at its first picture’s time and uses the first available photo GPS fix.

A new group starts on a different local date, after a gap of more than two hours, or when a picture is more than one kilometre from the group’s first GPS fix. Each event holds up to 20 photos. Pictures without GPS can join by time. Camera clocks with unknown offsets are grouped separately from timezone-aware captures. A picture without a capture time gets its own draft.

The app reads capture metadata locally. In Apell, reviewing the groups requests one title per event with a known time or location. Only the local capture time, its UTC offset when available, and latitude/longitude go to the active model. Photos, filenames, trip names and notes stay on the device. Edit a suggestion, request another after correcting the time or location, or enter a title yourself. The standalone browser preview uses manual titles.

Before saving, enter any missing times and UTC offsets, or uncheck **Include** to skip a group. Coordinates can stay empty. Saving adds all included events to the trip together. Events appear in Timeline and can be found by title. Photo GPS also places them on the **Actual visits** map.

## Map

The interactive map uses locally bundled Leaflet and online OpenStreetMap tiles. **Actual visits** shows only recorded event coordinates; **Named places** shows only standard reference positions. Counted pins group check-ins at exactly the same position, including different places. Open a pin to choose a visit. Check-ins without the selected kind of coordinates remain accessible in a separate list. Pins near the date line fit together correctly.

Tiles load only while Map is active. The browser uses ordinary HTTP caching; native Apell uses its HTTP bridge, two concurrent downloads, conditional revalidation, and a private cache bounded to 256 PNG slots plus metadata. Cache reads/writes never modify journal data. The loader honors server cache headers and uses seven days when freshness is unspecified. It does not prefetch areas or download offline map packages. When a background tile is unavailable, saved pins and check-in details remain usable and a retry control is shown.

Opening or moving the map sends the requested tile coordinates to OpenStreetMap, revealing the displayed map area. Photos, notes, and named-place records are not sent. The app and journal remain local. Attribution is visible on the map; Leaflet's license is included in the package. See the [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/) for service terms.

## Develop

Requires Bun and a compatible Apell checkout. From this directory:

```sh
bun run setup
bun run dev
```

Setup links the local `@apell/sdk` through an ignored `.apell-sdk` symlink, then installs dependencies. It finds the sibling `apell` checkout from the primary Git directory, including when this app is developed in a linked worktree. Set `APELL_ROOT` to select another host checkout, or `APELL_SDK_DIR` to override only the SDK. No machine-specific paths are stored in source or the lockfile.

Fieldnotes owns its canonical icon in `shared/assets/fieldnotes.svg` and uses the collection's shared light/dark theme. See the [collection README](../README.md) for artwork ownership and platform-theme updates. Map tiles and photos retain their original colors in either theme.

The development server binds to loopback only. Browser preview uses IndexedDB for metadata and original photo files; it supports the system file picker and foreground browser geolocation. The camera button uses the device’s image capture picker where supported, otherwise the ordinary file picker. Browser data is separate from the native applet.

## Package and install

```sh
bun run pack
```

This builds `artifacts/travel.apel`, `artifacts/travel.sha256`, and `artifacts/icon.png` for Store reuse with the sibling host’s `target/debug/apell` packer. The same 256 × 256 PNG is included as `icon.png` in the package. Set `APELL_BIN` to use another compatible packer. Install the package in Apell using **+ → Install from file**. The stable applet ID is `travel`; its display name is **Fieldnotes**.

The applet requests `fs`, `camera`, `photos`, `location`, `http`, and `llm`. Map tiles use the HTTP bridge. AI titles use the model connection configured in Apell. Camera, photo library, and location use the host’s existing iOS/Android APIs and permission prompts. Cancelling a sensor prompt leaves the draft intact. Desktop native sensor support depends on the host; manual coordinates and the browser preview remain available. No Apell host modifications are required.

## Editing and storage

- Trips have a name, optional date range, and description. Check-ins have a visit date/time, saved UTC offset, notes, and up to 20 photos of up to 32 MiB each.
- Visit times preserve the recorded local time even after the device changes time zones. Select the time zone in effect during a past visit, including any daylight-saving adjustment.
- Supported imports are JPEG, PNG, GIF, WebP, HEIC, HEIF, and AVIF. Originals are retained. Preview support depends on the browser/device codec; unsupported images display a clear fallback. Photos load near the viewport and release their object URLs offscreen.
- Drafts stay open after a failed save and can be retried. Closing a form with edits asks before discarding them. Save before closing/reloading the app; unsaved text is not recovered after termination. Closing the native applet during an import can leave unreferenced private photo files.
- Native metadata is an atomically replaced JSON snapshot, limited to 16 MiB, with photos stored separately in the applet’s private image directory. The browser saves newly included photo originals and journal changes in one IndexedDB transaction. It rejects stale writes from another tab. Corrupt metadata is reported without replacing it with an empty journal.
- Deletion requires confirmation. Cleanup of previously saved photos runs after the metadata save succeeds. Deleting a trip removes its visits and photos but retains reusable named places. A cleanup failure leaves a notice and unused files; saved entries are not rolled back.
- This version has no backup/export or synchronization. Clearing browser storage or removing native applet data can erase the journal. The journal is not uploaded; a system photo picker may retrieve a cloud-backed photo selected by the user.

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

Unit tests cover EXIF capture times and GPS, photo grouping, title request contents, domain validation, repeated visits, independent coordinates, time-zone boundaries, image ownership, atomic persistence, stale browser writes, failed-save retries, safe image paths, map grouping/date-line bounds, and tile cache/revalidation/cancellation. The browser smoke checks cover create/edit/reopen/delete, photos, bulk photo import and review, failed-save recovery, both primary views, and mobile layouts. The native smoke exercises the production bundle in an opaque sandboxed iframe with the real SDK bridge and simulated native services, including title generation and model errors. All automated map checks intercept tile requests with synthetic images; tests never traverse the live public tile service.

Physical-device camera, photo-picker, and GPS behavior still require validation in Apell on iOS/Android. Simulated bridge checks do not replace that device verification.
