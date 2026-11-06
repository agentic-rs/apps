# Recorder for Apell

A private recording library with native mobile recording, audio import and playback, editable transcripts, automatic language detection, and audio/text sharing. Speech recognition runs on the device using the Apell host’s multilingual Whisper Tiny model. No audio is uploaded and no speech-service API key is needed.

The applet requires the Apell host with `audio` and `speech` services. Keep a checkout at the sibling `../../apell` path, or adjust the local SDK dependency and set `APELL_BIN` to a compatible packer.

## Develop and package

```sh
bun install
bun run dev
bun run test
bun run build
bun run pack
```

The development server binds to loopback. The browser preview supports actual microphone recording, import, playback, persistence in IndexedDB, and sharing/download. On-device transcription is supplied by the native host and is not simulated in the browser preview.

`bun run pack` creates `artifacts/recorder.apel` and its SHA-256 checksum. Install the package from Apell’s **+ → Install from file** flow. The stable applet ID is `recorder`; future versions retain its private data. If the applet was already running when updated, restart Apell before opening the new version.

## Use

1. Tap **Record**, grant microphone access, and keep Apell open while recording. Pause/resume as needed, then choose **Save recording**.
2. Use the import button to choose an existing audio file. Native transcription supports WAV, M4A/AAC, MP3, FLAC, and Ogg/Vorbis; exact playback availability depends on the device.
3. Open transcription settings and download the multilingual model once (about 75 MB). The download needs a connection; subsequent transcription works offline.
4. Open a recording, leave **Spoken language** on automatic detection or select a language, and choose **Transcribe recording**. A running transcription or download can be cancelled.
5. Edit the title or transcript, save your changes, then share the audio or a plain-text transcript using the share buttons.

Whisper Tiny prioritizes small size and local execution. Transcription accepts files up to 30 minutes long; split longer audio before importing it. WebM and Opus are not supported by native transcription. Review names, numbers, and short or noisy clips. Transcription runs while the host remains open; mobile suspension or termination can interrupt it. Incoming OS share-extension imports are not part of this applet; use its native file picker to import audio.

## Storage and recovery

Audio lives in Apell’s private file area. Each recording has a versioned JSON metadata file in `recorder-metadata/`, stored through atomic host writes. On reopening, finalized audio without metadata is restored as a **Recovered recording**, with the recovery date; its duration becomes available through playback. Transcript exports are written to `recorder-exports/` before opening the native share sheet. Audio stays local until you explicitly share it.

If a metadata write fails, the app retains the recording in memory and presents **Retry save**, blocking new recordings/imports until it succeeds. Browser preview data is separate from native applet data and can be erased by clearing browser storage. Export recordings you want to back up.

The applet declares `fs`, `audio`, and `speech` permissions. It does not declare network or shared-LLM access. All serialized app-owned field names use snake_case. Build artifacts, local environment files, and dependencies are ignored by Git.

## Verification

TypeScript checks, the production build, seven persistence/export tests, and Firefox recording/import/playback/persistence workflows pass. The production bundle was also checked in an opaque iframe with Apell's restrictive content policy, including its message-channel handshake and secure-context ID fallback.

The iOS simulator build was installed and verified with native playback, the share sheet, on-device language detection/transcription, and transcript persistence across a restart. Browser recording tests use a simulated microphone; physical-device microphone behavior still needs verification. Android native Kotlin sources compile against Tauri, but a full Android APK/runtime check remains pending because the existing generated host uses an incompatible AGP/Kotlin plugin combination.
