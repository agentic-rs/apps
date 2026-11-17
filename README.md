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

Setup installs the collection's pinned packaging tools before installing app dependencies. Running `bun run setup` inside one app also prepares those shared tools. Setup discovers the sibling host through Git's primary checkout, including from linked app worktrees. Set `APELL_ROOT` to select another host checkout, `APELL_SDK_DIR` to override only the SDK, or `APELL_BIN` to override only the packer. SDK links stay ignored; local paths never enter manifests or lockfiles. Each app retains its own development server, dependencies, tests, and `.apel` package.

## Apell appearance

This repository is the canonical source for Recorder, Learning, and Fieldnotes names, IDs, icons, and app-specific styles. Edit the original SVG artwork in `shared/assets`; the app content and favicons use it directly. Applet IDs remain `recorder`, `learning`, and `travel`, so updates preserve existing private data.

Apell owns the platform's light/dark theme tokens and host controls. `shared/host-tokens.css` is a tracked snapshot of those tokens; `shared/apell.css` defines this collection's semantic styles on top. After updating the sibling Apell checkout, refresh the platform tokens from its latest committed revision:

```sh
bun run sync:theme
bun run build
```

Review the generated diff and check both color schemes before committing. Theme sync reads committed host files and never changes app artwork. The host supplies its outer title bar and permission controls; each app retains its own task navigation.

## Package icons

`bun run pack` renders each canonical SVG to a 256 × 256 PNG using the pinned renderer. The package contains this image as root-level `icon.png`; identical bytes are written to the app's `artifacts/icon.png` for Store publication. Host launchers and marketing sites consume the app-owned artwork. Generated PNGs and packages stay out of Git.

Package icons are optional assets and add no manifest fields. Compatible hosts display them in the launcher; older hosts can still install the package and use their existing fallback. The manifest's app name remains authoritative, and official-publisher status is not self-declared by app metadata.
