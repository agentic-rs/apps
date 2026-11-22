# Official Apell apps

The official Apell apps, developed together on `main` and packaged independently.

- [Recorder](recorder/README.md) supports audio documents, text and voice channels, local or API transcription, playback, and sharing.
- [Learning](learning/README.md): an AI guide for exploring topics, understanding key points, and remembering what you learn.
- [Fieldnotes](travel/README.md) organizes trips into daily itineraries with ordered stops, route maps, check-ins and photo journals.

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
Select `build_only` to verify and retain the packages without publishing them.

Before the first run, use a current Apell CLI with Store account commands to
register the packages and configure their GitHub Actions connections. Replace the
example address with the Store's canonical HTTPS origin:

```sh
apell login --store https://store.example.invalid --no-browser
```

Open the printed address, sign in with GitHub, compare the verification code,
and approve CLI access. Login remembers the Store address. After it completes,
register any IDs not already registered to your account:

```sh
apell package register recorder
apell package register learning
apell package register travel
```

As a package owner or maintainer, configure each connection:

```sh
for applet_id in recorder learning travel; do
  apell package oidc set "$applet_id" \
    --repo agentic-rs/apps \
    --workflow .github/workflows/publish-apps.yml \
    --ref refs/heads/main \
    --event workflow_dispatch
done
```

The explicit event permits manual runs only. Omitting `--environment` leaves the
environment unset; `oidc set` replaces the complete connection policy. Verify a
connection with `apell package oidc show recorder` (repeat for the other IDs).
Set the repository variable `APELL_STORE_URL` to the same canonical HTTPS origin.
No publishing secret or operator token is needed.

The workflow uses Apell's `setup` and `publish` actions at `actions-v1.0.0`.
The build job pins Bun 1.3.13 and checks out the applet SDK separately at revision
`7517beab013e8db7364392e091ab17beb0cabccd` to preserve existing package bytes.
It installs frozen lockfiles, tests all apps, and type-checks and packs each app.
Only the publishing jobs receive `id-token: write`. The `publish` action uses
GitHub OIDC with no token fallback. Each `official-apps-<attempt>` run artifact
retains the exact packages, icons, listing metadata, manifests, and checksums for
30 days.
Publishing jobs download the artifact ID returned by their prerequisite build.
Re-running all jobs creates a separate artifact without replacing the earlier
attempt's files. Each job's summary records the app version and package SHA-256.

Versions are immutable after publication, including listing metadata and icons.
Update an app's `package.json` version and `publish.json` release notes before
publishing changed content. All three `0.3.1` releases were
[published through OIDC](https://github.com/agentic-rs/apps/actions/runs/44153003294).
Their Store packages, metadata, and icons were verified against the retained CI
artifacts. Linux CI output is the definitive published bytes, since local icon
rendering can vary across platforms. Retry a failed publishing job from the same
run to reuse its retained package. A fresh build of an existing version is accepted
only when all uploaded bytes and metadata match the existing release.
