# Fieldnotes for Apell

Fieldnotes is a local-first itinerary planner for Apell. Open a trip, choose a day, and arrange the places you want to visit. Photos and check-ins keep a record of what happened along the way.

The mobile interaction reference is QYER’s 穷游行程助手. Its separate day actions for sightseeing and lodging, day-map route optimizer and trip toolbox guide the corresponding Fieldnotes flows. [Illustrated walkthrough of the day actions (step 8)](https://jingyan.baidu.com/article/a501d80c1d38a5ec630f5e29.html) · [Apple’s walkthrough of the iPhone app](https://apps.apple.com/cn/iphone/story/id1469876186)

## Plan a trip

1. Select **New trip** and tap a city in the offline picker, or enter your own city name. Fieldnotes saves a one-city trip and opens its itinerary. Use **Edit trip** whenever you want to rename it or set dates.
2. Open a day in **Itinerary**. **Add stop** opens sights near the first city of the day. **Add hotel** opens lodging near the last city. On a transfer day, tap a city to browse there. The picker remembers each city and category’s search while you compare. Tap a place to review its address and day, or use **Change place** to return to the list. For a hotel, set the check-in and check-out dates. Tap **Add to Day 2** on the second day of a dated trip, or **Add to itinerary** on an undated trip. **Enter manually** works for any stop.
3. On a transfer day, new sights, food stops and other activities go before the first stop in a later city when the existing stops follow the scheduled city order. For example, a Kyoto sight goes before JR Nara Station on the Kyoto → Nara day. A hotel, an airport or a stop on a day with an uncertain city order starts at the end. Tap **Route position** in the review to see the neighboring stops and their cities and choose another position. A saved stop keeps its place until you change its position or day.
4. Select **Check in** at a stop to attach an entry and photos, or **New check-in** to record an unplanned visit. The entry keeps its own local date even when the plan changes.

Tap **＋** beside a nearby sight to add it directly to the selected day. If it goes before another stop, the confirmation names that stop. Its row changes to **On this day** and the list stays open. Tap the place name to review it first. From a new sight or hotel review, **Add and choose another** saves the stop and returns to the results. On the same day, the selected city, category, search and scroll position carry over. Each new review starts with its own schedule and notes. **Done** returns to the itinerary. [行程助手’s sightseeing picker, steps 10–15](https://www.sohu.com/a/331566931_503432)

Open **Overview** to see the cities and planned stops for each day. Tap a day to open it. **Add day** extends the itinerary by one calendar day and opens that day.

On a day with two or more planned stops, tap the reorder arrows beside **Map**, or **Reorder** on the day map. Drag a handle to move a stop several places, or tap it to choose a position. The numbered map previews each move. **Done** saves the whole order and **Cancel** returns to the original route. Stop times, hotel dates and check-ins stay with their stops. Stops without coordinates can also be rearranged. [行程助手’s mobile arrangement screen, page 14](https://www.pmdaniu.com/index.php/storages/95419/27de68b70b9d6a22b410d2a0eabd8926-54667/1303sZobr5wc.pdf#page=14)

When you finish adding places, the itinerary brings the last saved stop into view. If you edit a stay from an overnight or checkout day, returning to that day brings its hotel row into view.

In a sight or hotel search, tap **Map** beside the results heading. Tap a pin or use the arrows to compare places, including those that share coordinates. Each new place shows its straight-line distance to the nearest numbered stop or overnight hotel with coordinates, including the checkout hotel. On a transfer day, tap either city to see its results. **Day route** fits the results and the numbered itinerary stops together. **Review place** opens the stop or hotel review. Back returns to the selected place on the map, then to the list.

From a stop’s review, **View on map** previews the day in the proposed order. The highlighted pin carries the stop’s proposed number. Dashed lines connect consecutive stops with coordinates. The nearest stop or hotel and its straight-line distance help you compare locations before saving. Use **Back** to return to the same route position, dates and notes. The map action is available for directory results and manually entered coordinates.

An overnight or checkout hotel appears with a bed pin on the day map and on the maps used to compare places. Tap it to see whether you are staying or checking out. The day map also lets you reopen the original stay. These pins keep the day's stop numbering and route order intact.

When a search result says **On this day**, tap it to edit the saved visit or stay, or choose **Add another visit** or **Add another stay**. Typing also searches the day's saved stops in the selected city. If the directory uses a different pin for a sight, you can reopen your original stop under **On this day**. Saved stops remain searchable offline. Hotel stays appear on each night from check-in through the night before check-out.

When your plans expand, tap **Add a city**, pick the destination and choose the day you travel. On the transfer day, the itinerary shows both cities, such as **Tokyo → Kyoto**. The following days show **Kyoto** until the next transfer. On a trip with no dates or entries, scheduling a later transfer keeps the day you were planning as Day 1. If the transfer falls after an existing end date, the app shows the new end date before you save.

Use **Choose date later** to keep a destination without assigning it to a day. **Edit trip** lets you set or clear its travel date later. Moving a city earlier swaps destinations between the scheduled dates. Stops, check-ins and photos stay on their respective days.

The **Journal** tab brings together all the trip’s entries and lets you search by title, place, area, or notes. Use **Trips** to switch trips or search the library by trip name and city.

A planned stop can have a map position. Check-ins can separately record the actual visit position and a reusable named place with reference coordinates. Checking in at a stop prefills the place name and any reference coordinates. Enter the actual visit location manually or use foreground GPS. **Use current location** measures the device’s present location. All coordinates use WGS84.

## Place search

Tap the filter beside the results heading or in the map header to choose museums and galleries, parks and gardens, places of worship, hotels, hostels or guest houses. The directory searches the selected city for that type. Each city remembers its sight and lodging choices while the picker is open. The type also applies when you search by name. Choose **All sights** or **All lodging** to clear it. When the directory identifies a venue’s type, Fieldnotes shows it beside the address and saves it with the stop. Typed stops on the day can also be found offline by filtering.

The app package includes searchable names and alternate spellings for 34,247 cities and 9,053 airports. City results show country and region for namesakes. Airport search works by name, municipality, IATA code such as `KIX`, or ICAO code. Both directories work from first launch without a network connection. The app reads local compressed indexes on demand. [GeoNames city data, CC BY 4.0](https://www.geonames.org/export/) · [OurAirports, public domain](https://ourairports.com/data/)

**Sights** and **Hotels** request places within 10 km of the selected city centre. Typing filters nearby results on the device. Tap **Search** to look up a name within 40 km. If the provider locates a match in another city on the day’s route, tap that city’s search shortcut to look there. Fieldnotes reuses successful searches in memory for five minutes. The provider receives the search area, category and any submitted text. A custom city without a known position is included in a Photon text search. Saved stops keep the selected planning city, place name, available address and coordinates offline.

The default provider is Photon's public service for moderate traffic. To use Geoapify, supply `VITE_GEOAPIFY_PUBLIC_KEY` when building Fieldnotes. This must be a client-distributable key because the applet includes its value. Geoapify searches require a city with known coordinates. [Photon service](https://github.com/komoot/photon#usage) · [Geoapify Places API](https://apidocs.geoapify.com/docs/places/places/)

Source URLs, hashes and credits are in [directory/sources.json](public/directory/sources.json). From the app directory, run `bun run directory:build` to refresh the bundled indexes, or supply a directory containing the three named source files to regenerate them offline.

## Events from photos

Open **Events from photos** in a trip’s itinerary or journal and add pictures. The browser supports multiple selection. Apell’s native photo picker adds one original per selection. **Review events** shows the grouped pictures. Each starts at its first picture’s time and uses the first available photo GPS fix.

A new group starts on a different local date, after a gap of more than two hours, or when a picture is more than one kilometre from the group’s first GPS fix. Each event holds up to 20 photos. Pictures without GPS can join by time. Camera clocks with unknown offsets are grouped separately from timezone-aware captures. A picture without a capture time gets its own draft.

The app reads capture metadata locally. In Apell, reviewing the groups requests one title per event with a known time or location. Only the local capture time, its UTC offset when available, and latitude/longitude go to the active model. Photos, filenames, trip names and notes stay on the device. Edit a suggestion, request another after correcting the time or location, or enter a title yourself. The standalone browser preview uses manual titles.

Before saving, enter any missing times and UTC offsets, or uncheck **Include** to skip a group. Coordinates can stay empty. Saving adds all included events to the trip together. Events appear on their recorded days and can be found by title in the trip journal. Photo GPS also places them on the **Actual visits** map.

## Map

The map opens on **Day route**. Numbered pins show the selected day’s planned stops. A dashed line connects consecutive stops with coordinates in itinerary order. Gaps indicate missing positions. The line represents the planned sequence and provides no turn-by-turn directions. Select a pin to open a stop.

Tap the map button beside **Add stop** to see the day's numbered route. Open **Stop list** to edit or reorder stops while viewing the map. For a suggested order, tap **Optimize route**, choose a starting stop and a finishing stop, then compare the straight-line distances. Each stop needs coordinates for optimization. **Apply order** updates the day’s itinerary and pins together. Scheduled times and journal links stay attached to their stops.

The map uses locally bundled Leaflet and online OpenStreetMap tiles. **Actual visits** shows recorded event coordinates for the selected day. **Named places** shows the reference positions of places in those entries. Counted pins group check-ins at exactly the same position, including different places. Open a pin to choose a visit. Check-ins without the selected kind of coordinates remain accessible in a separate list. Pins near the date line fit together correctly.

Tiles load when you open a map, including a place preview. The browser uses ordinary HTTP caching. Native Apell uses its HTTP bridge, two concurrent downloads, conditional revalidation, and a private cache bounded to 256 PNG slots plus metadata. Cache reads and writes are independent of journal data. The loader honors server cache headers and uses seven days when freshness is unspecified. It requests the visible area as you pan and zoom. When the background is unavailable, the map still shows place pins and offers a retry.

Opening or moving the map sends the requested tile coordinates to OpenStreetMap, revealing the displayed map area. Photos, notes, and named-place records are not sent. The app and journal remain local. Attribution is visible on the map; Leaflet's license is included in the package. See the [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/) for service terms.

## Trip toolbox

Open **Toolbox** within a trip to use its **Packing list** or **Expenses**. The checklist starts with five travel essentials. Tick items as you pack, add custom items, or use **Edit items** to rename and remove them.

For an expense, enter a name, date, category, amount and currency. Tap a recorded expense to edit or delete it. The ledger groups spending by day and totals each currency separately. Routes, checklists and expense calculations run locally.

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

### Update the iOS simulator

From the repository root, run `bun run --cwd travel sim:update` after a Fieldnotes change. It builds the applet, boots **Apell iPhone 16 Pro**, and verifies the installed package against the local SHA-256. A changed package relaunches the installed Apell debug shell and preserves saved journals. An identical package leaves the running session alone.

For initial shell setup, run `apell dev --target 'Apell iPhone 16 Pro'` from the Apell checkout. Set `APELL_SIMULATOR` to target a different simulator name or UDID.

## Editing and storage

- Journals from schemas 1 through 7 open with their trips, stops, travel dates, visits, photos and toolbox data intact. The next save writes schema 8. Newly picked stops can store the selected planning city and its directory ID. Older stops retain their existing place information.
- Trips have a name, cities, an optional date range, and a description. Check-ins have a visit date/time, saved UTC offset, notes, and up to 20 photos of up to 32 MiB each.
- Visit times preserve the recorded local time even after the device changes time zones. Select the time zone in effect during a past visit, including any daylight-saving adjustment.
- Supported imports are JPEG, PNG, GIF, WebP, HEIC, HEIF, and AVIF. Originals are retained. Preview support depends on the browser/device codec; unsupported images display a clear fallback. Photos load near the viewport and release their object URLs offscreen.
- Drafts stay open after a failed save and can be retried. Closing a form with edits asks before discarding them. Save before closing/reloading the app; unsaved text is not recovered after termination. Closing the native applet during an import can leave unreferenced private photo files.
- Native metadata is an atomically replaced JSON snapshot, limited to 16 MiB, with photos stored separately in the applet’s private image directory. The browser saves newly included photo originals and journal changes in one IndexedDB transaction. It rejects stale writes from another tab. Corrupt metadata is reported without replacing it with an empty journal.
- Deletion requires confirmation. Cleanup of previously saved photos runs after the metadata save succeeds. Deleting a stop detaches its check-ins and preserves their photos. Deleting a trip removes its stops, visits and photos. Reusable named places stay available. A cleanup failure leaves a notice and unused files; saved entries are not rolled back.
- This version has no backup/export or synchronization. Clearing browser storage or removing native applet data can erase the journal. The journal is not uploaded; a system photo picker may retrieve a cloud-backed photo selected by the user.

Generated packages, dependencies, screenshots, local SDK links, and environment files are excluded from Git. The [example trips](fixtures/README.md) contain published itineraries with fixed test dates and map coordinates. Test visits and photos are synthetic.

## Verification

```sh
bun run check
bun test
bun run format:check
bun run test:ui
bun run test:native
bun run pack
```

Browser checks use Firefox through Playwright. Install its Firefox runtime with `bunx playwright-core install firefox`, or set `FIREFOX_PATH` to an existing Playwright-compatible Firefox executable. These tests use disposable browser contexts on temporary loopback servers. They never control Chrome or access the real journal. Screenshots are saved under ignored `artifacts/qa`.

Unit tests cover EXIF capture times and GPS, photo grouping, title request contents, domain validation, repeated visits, independent coordinates, time-zone boundaries, image ownership, atomic persistence, stale browser writes, failed-save retries, safe image paths, map grouping/date-line bounds, and tile cache/revalidation/cancellation. The browser smoke checks cover create/edit/reopen/delete, photos, bulk photo import and review, failed-save recovery, daily stop ordering, linked check-ins, route maps, and mobile layouts. The native smoke exercises the production bundle in an opaque sandboxed iframe with the real SDK bridge and simulated native services, including title generation and model errors. All automated map checks intercept tile requests with synthetic images; tests never traverse the live public tile service.

Physical-device camera, photo-picker, and GPS behavior still require validation in Apell on iOS/Android. Simulated bridge checks do not replace that device verification.
