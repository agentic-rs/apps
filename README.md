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

## Publish through GitHub Actions

[Publish official apps](.github/workflows/publish-apps.yml) publishes Recorder,
Learning, and Fieldnotes through Apell's GitHub OIDC authentication. It runs only
when manually dispatched from `main`; pushing a commit does not publish a release.

Before the first run, a package owner or maintainer registers `recorder`,
`learning`, and `travel` in the Store and configures each package's GitHub Actions
connection with this public repository, workflow `.github/workflows/publish-apps.yml`,
allowed ref `refs/heads/main`, and event `workflow_dispatch`. Leave the environment
unset. Set the repository variable `APELL_STORE_URL` to the Store's canonical
HTTPS origin. No publishing secret or operator token is needed.

The workflow pins Bun 1.3.13, Rust 1.99.0, and Apell revision
`7517beab013e8db7364392e091ab17beb0cabccd`. Its build job installs frozen lockfiles,
tests all apps, and type-checks and packs each app before any publication. Only the
separate publishing jobs receive `id-token: write`; they use `--auth github-oidc`
with no token fallback. Each `official-apps-<attempt>` run artifact retains the
exact packages, icons, listing metadata, manifests, checksums, and CLI for 30 days.
Publishing jobs download the artifact ID returned by their prerequisite build.
Re-running all jobs creates a separate artifact without replacing the earlier
attempt's files. Each job's summary records the app version and package SHA-256.

Versions are immutable after publication, including listing metadata and icons.
Update an app's `package.json` version and `publish.json` release notes before
publishing changed content. The current `0.3.1` packages are release candidates;
the Linux CI output becomes the definitive published bytes, since local icon
rendering can vary across platforms. Retry a failed publishing job from the same
run to reuse its retained package. A fresh build of an existing version is accepted
only when all uploaded bytes and metadata match the existing release.
