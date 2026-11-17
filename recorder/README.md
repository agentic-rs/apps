# Recorder for Apell

Recorder keeps two kinds of audio work in one private library:

- **Documents** turn interviews, meetings, and longer recordings into editable text. Each document keeps its original audio, detected language, and transcript.
- **Channels** organize quick voice notes into named, chronological timelines. Each note keeps its own timestamp, audio, and editable transcript.

New channel notes and audio imported into a channel transcribe automatically after saving. Document transcription starts when you choose **Transcribe**. Speech recognition runs on the device using the Apell host’s multilingual Whisper Tiny model. No audio is uploaded and no speech-service API key is needed.

The applet requires the Apell host with `audio` and `speech` services, including long-audio transcription support. Setup discovers the sibling `apell` checkout through Git, including from linked worktrees. Set `APELL_ROOT` to select another host checkout, or use `APELL_SDK_DIR` and `APELL_BIN` to override the SDK and packer separately.

## Develop and package

```sh
bun run setup
bun run dev
bun run test
bun run build
bun run pack
```

The development server binds to loopback. The browser preview supports microphone recording, documents, channels, import, playback, persistence in IndexedDB, and sharing/download. On-device transcription is supplied by the native host and is not simulated in the preview. Browser data is separate from native applet data.

Recorder owns its canonical icon in `shared/assets/recorder.svg` and uses the collection's shared light/dark theme. See the [collection README](../README.md) for artwork ownership and platform-theme updates.

`bun run pack` creates `artifacts/recorder.apel`, its SHA-256 checksum, and `artifacts/icon.png` for Store reuse. The same 256 × 256 PNG is included as `icon.png` in the package. Install the package from Apell’s **+ → Install from file** flow. The stable applet ID is `recorder`; updates retain private data. Restart Apell before opening an updated applet if it had already been running.

Use the bottom navigation to switch between **Documents** and **Channels**, or open **Settings** for the on-device model. Content fills the applet viewport; recording controls sit above navigation while lists, documents, and message history scroll independently.

## Documents

Choose **Documents**, then record or import audio. Save the recording to add it to your library, and choose **Transcribe** when ready. Open a document to play its audio, edit the title and transcript, or share text and audio. You can also start writing before transcription; saved manual text is preserved unless you explicitly replace it. Changes remain a draft until **Save changes**; navigation asks you to save or discard them first.

Existing Recorder recordings appear as Documents after upgrading, with their original audio, titles, dates, and edited text preserved.

## Channels

Choose **Channels**, create a named channel, and record short notes into it. Channels use a conversation list ordered by the latest note, message-style audio bubbles, and a fixed microphone/attachment bar. Each saved note appears separately in chronological order, with its recording timestamp. The header and recording controls stay visible while the history scrolls. Import also adds a separate note to the selected channel. The recording destination is captured when recording starts, so changing the visible workspace does not move a recording in progress.

Open a note’s **… → Edit text** control to correct its transcript, then save or discard the changes. Channel names can be changed. Only empty channels can be deleted; removing a voice note requires its own confirmation.

## On-device transcription

Download the multilingual model once from transcription settings (about 75 MB). Saved recordings wait while the model is unavailable. Queued work runs one recording at a time, so you can continue capturing notes while earlier recordings transcribe. Cancel an individual queued/running transcription from its document or note; retry it when ready. Replacing an existing transcript requires confirmation.

Recordings up to 3 hours are supported by the updated host. Audio imports can be up to 2 GiB in Apell or 128 MiB in the browser preview. Native transcription accepts WAV, M4A/AAC, MP3, FLAC, and Ogg/Vorbis. WebM and Opus are not supported. Keep Apell open while recording and transcribing; mobile suspension or termination can interrupt work. Incoming OS share-extension imports are not included; use the applet’s native file picker.

Whisper Tiny prioritizes small size and local execution. Review names, numbers, and short or noisy clips before relying on a transcript. Export recordings you want to back up.

## Storage and recovery

Audio and metadata live in Apell’s private file area. Browser preview data lives in IndexedDB and can be erased by clearing browser storage. Neither mode uploads audio. Sharing uses an explicit user action.

If saving metadata fails, the app retains the pending recording and offers **Retry save**. Keep the screen open until saving succeeds. Recording drafts retain their original destination for recovery; finalized audio without known metadata is recovered as a Document.

The applet declares `fs`, `audio`, and `speech` permissions. It does not declare network or shared-LLM access. All serialized app-owned field names use snake_case. Build artifacts, local environment files, downloaded models, and dependencies stay out of Git.

## Verification

Recorder 0.2.3 passes TypeScript checks, production packaging, formatting, and 35 tests covering migration, channel/capture recovery, large native directories, queue ordering, cancellation, concurrent edits, and failed saves. Firefox desktop/mobile checks cover recording, imports, document editing, multiple channels, capture destinations, persistence, the fixed chat composer, bottom navigation, and recording controls across mode changes. Focused conversation checks cover compact action menus, transcript editing with a keyboard-sized viewport, and preserving the reader’s position while background transcripts change. A production bundle in an opaque iframe also passes the native message bridge/content-policy checks with simulated audio and speech responses.

The updated Apell host passed a three-hour streaming transcription test with real Whisper inference, and its iOS simulator build was installed with Recorder. Physical-device microphone behavior and Android runtime behavior remain unverified. The browser preview does not run Whisper.
