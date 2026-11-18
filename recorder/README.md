# Recorder for Apell

Recorder keeps audio documents and channel notes in one library.

- **Documents** turn interviews, meetings, and longer recordings into editable text. Each document keeps its original audio, detected language, and transcript.
- **Channels** organize typed and recorded notes into named timelines. Each note keeps its own timestamp. Voice notes also keep their audio and editable transcript.

Recording or importing audio in a channel queues it for transcription. Typed notes appear immediately. Document transcription starts when you choose **Transcribe**. Settings controls which recognizer handles queued audio.

The applet requires the Apell host with `audio` and `speech` services, including long-audio transcription support. Setup discovers the sibling `apell` checkout through Git, including from linked worktrees. To pair an apps worktree with a host worktree, enable Git's worktree configuration once (`git config extensions.worktreeConfig true`), then run `git config --worktree apell.hostRoot /absolute/path/to/host-worktree`. Set `APELL_ROOT` to override the checkout for a single run, or `APELL_SDK_DIR` for a separate SDK. Recorder uses `APELL_BIN`, then `apell` on PATH, then the host checkout’s debug CLI.

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

After changing Recorder or its native host features, run `bun run sync:simulator` from this directory with an Apell CLI that supports `dev --install`. It packages Recorder, builds the signed development host, relaunches Apell on **Apell iPhone 16 Pro**, and waits for the host to report `Installed recorder <version>`. Set `APELL_SIMULATOR` to select another iPhone simulator by name or UDID. You can repeat the command for local changes at the same version. Existing documents and channels stay on the simulator.

Use the bottom navigation to switch between **Documents** and **Channels**, or open **Settings** to choose a transcription provider. The recording controls sit above navigation while the library, editor, and timeline scroll independently.

## Documents

Choose **Documents**, then record or import audio. Save the recording to add it to your library, and choose **Transcribe** when ready. Open a document to play its audio, edit the title and transcript, or share text and audio. You can write before transcribing. **Save changes** commits the draft. Leaving an edited document asks whether to keep editing or discard changes. Deleting a document opens a confirmation naming the document and explaining what it removes.

Existing Recorder recordings appear as Documents after upgrading, with their original audio, titles, dates, and edited text preserved.

## Channels

Choose **Channels** and open a channel. Type in **Write a note** and tap the send arrow or press Enter. Shift+Enter adds a line break. An unsent draft stays with its channel while you switch channels or tabs in Recorder. Tap the microphone when the field is empty to record, or tap **+** to import audio. The recording destination is captured when recording starts.

The timeline shows text and voice notes in chronological order. The channel list shows the latest note and total count. Open a voice note’s **… → Edit text** control to correct its transcript. Each note has a delete action with confirmation. You can rename a channel or delete it once it is empty.

## Transcription

Open **Settings** and choose a recognizer. Apell remembers the choice for future sessions.

| Recognizer | Setup and behavior |
| --- | --- |
| Downloaded model (default) | Download multilingual Whisper Tiny once (about 75 MB). Apell verifies the download and can resume an interrupted transfer. Recognition runs locally. |
| System recognizer | On supported iOS and macOS devices, allow Apell to use Apple Speech. Recognition runs locally and uses the device language unless you choose another language for a document. |
| Transcription API | Choose an OpenAI or OpenAI-compatible connection in Apell and select or enter a transcription model ID, such as `whisper-1`. Applying the choice sends queued recordings and future transcription requests to that connection. The file limit is 25 MB per request. Credentials stay with Apell. |

System and API recognition require a host that advertises those capabilities. Android supports the downloaded model and API. The browser preview supports editing, recording, and playback. Use the native app for speech recognition.

Recorder runs one transcription at a time. You can keep recording, cancel queued or running work, and retry a failed job from its note or document. Replacing saved text asks for confirmation.

Apell accepts audio imports up to 2 GiB, and the preview accepts up to 128 MiB. Downloaded Whisper supports WAV, M4A/AAC, MP3, FLAC, and Ogg/Vorbis and accepts recordings up to three hours. Other recognizers have their own format and duration limits. Keep Apell open during recording and transcription.

## Storage and recovery

Audio and metadata live in Apell’s private file area. Browser preview data lives in IndexedDB and can be erased by clearing browser storage. Sharing and API transcription use the destinations you choose.

If saving metadata fails, the app retains the pending recording and offers **Retry save**. Keep the screen open until saving succeeds. Recorder recovers recordings to their original destination when possible and places other finalized audio in Documents.

Recorder uses the host’s `fs`, `audio`, and `speech` permissions for local audio, `config` for recognizer preferences, and `llm` for the API connection. The host downloads the model and issues API requests. Build artifacts, downloaded models, local environment files, and dependencies stay out of Git.

## Verification

Run `bun run test` for storage migrations, recovery, mixed text and voice timelines, provider routing, queued jobs, cancellation, concurrent editing, and failed saves. Run `bun run pack` to type-check and build the installable applet.
