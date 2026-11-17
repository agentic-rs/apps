# Official Apell apps

The official Apell apps, developed together on `main` and packaged independently.

- [Recorder](recorder/README.md): audio recording, import, playback, on-device transcription, and sharing.
- [Learning](learning/README.md): an AI guide for exploring topics, understanding key points, and remembering what you learn.
- [Fieldnotes](travel/README.md): a mobile travel journal with Timeline and Map views, photo check-ins, and distinct visit and named-place locations.

See each applet's README for development, packaging, and verification instructions. Generated packages, build output, dependencies, and local environment files are excluded from Git.

## Develop the collection

Requires Bun and a sibling `apell` checkout. From this repository's root:

```sh
bun run setup
bun run test
bun run build
bun run pack
```

Setup discovers the sibling host through Git's primary checkout, including from linked app worktrees. Set `APELL_ROOT` to select another host checkout, `APELL_SDK_DIR` to override only the SDK, or `APELL_BIN` to override only the packer. SDK links stay ignored; local paths never enter manifests or lockfiles. Each app retains its own development server, dependencies, tests, and `.apel` package.

## Apell appearance

All apps use the canonical Recorder, Learning, and Fieldnotes artwork from Apell and the host's shared light/dark color tokens. `shared/apell.css` adds app-specific semantic colors, while the original host tokens and SVGs are tracked snapshots. Applet IDs remain `recorder`, `learning`, and `travel`, so updates preserve existing private data.

After updating the sibling Apell checkout, refresh the shared brand assets from its latest committed revision:

```sh
bun run sync:brand
bun run build
```

Review the generated diff and check both color schemes before committing. Sync reads committed files so unrelated host edits do not enter the snapshot. The host supplies its outer title bar and permission controls; each app retains its own task navigation. Icons are bundled in app content and favicons. The current host manifest schema has no icon or official-publisher field, and launcher/store artwork is managed by the host separately.
