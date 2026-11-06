# Learning for Apell

Learning is an AI learning guide built around curiosity and a lasting record of understanding.

The app opens to **Topics**. Use **+** to create one, open its key points, and tap a point to enter its conversation. Chat has its own screen with a fixed composer; **Memory** opens the topic’s saved learning notes. Back returns through the screen hierarchy and asks before discarding drafts. Topic model details and deletion live under **Topic options**. Apell supplies the outer applet controls and keyboard sizing.

1. **Create a topic.** Name something you want to learn and optionally describe your starting point or goal.
2. **Map the key points.** Choose an AI model through Apell. The guide suggests four to eight concrete ideas to explore.
3. **Explore together.** Start anywhere, ask questions, work through examples, and explain ideas in your own words. Each point keeps its own conversation.
4. **Remember automatically.** After each completed exchange, the AI records what you understand, ideas you covered, and questions to revisit. No approval step is required.

The **Memory** view collects these notes for the current topic. The guide receives them in later questions within that topic, so it can build on what you already understand. It is instructed to mark a point learned only when you demonstrate or explicitly state understanding, rather than merely receive an explanation. This is an AI assessment, and you can correct the summary or learning status through **Edit memory** or **Mark as still exploring**. This version uses flexible conversations rather than a mandatory lesson or quiz sequence.

## AI and storage

The applet requires the current Apell host with `llm.choose_model`, `llm.config`, `llm.generate`, and atomic private file writes. Configure a provider in Apell, then choose its model inside Learning. The applet requests `fs` and `llm` permissions. Credentials stay with the host; the applet has no provider keys or direct HTTP access.

Topics, completed exchanges, model attribution, and learning memories save in the applet's private files. The entire replayable assistant message is preserved, including provider metadata. A topic keeps its selected model once its key points have been generated; create another topic to use a different model. Conversations and memories are scoped to their topic, with no account sync or cross-topic memory.

Generation sends the relevant topic, learner goal, selected point's conversation, and topic memories through the chosen model connection. Each successful exchange is followed by a separate model request to update memory using that point's exchanges and previous memory. Local storage does not mean the chosen AI provider runs locally.

The conversation saves before its memory update starts. If memory generation fails or is stopped, the conversation remains saved; **Update memory** retries only the memory request. Each memory tracks the exchange it includes, so incomplete updates stay visible after reopening the applet.

**Stop** cancels the current generation. Incomplete answers remain visibly labeled and are not saved as completed exchanges. If a save fails, the complete result remains in the open applet and **Retry save** retries storage without regenerating that result, then finishes any outstanding automatic memory update. **Discard unsaved changes** restores the last saved state. In-app navigation protects unsaved writing with confirmation. Keep the applet open until saving finishes: closing Apell can lose an unsent question, unsaved memory edits, an in-flight response, or a result whose save failed.

Requests enforce the host's 256-message / 512 KiB limits, including provider metadata; oversized context returns an explicit error rather than silently dropping history. A saved topic is limited to 8 MiB. Corrupt or unsupported saved data produces a load error and is not overwritten. There is no automatic backup or export in this version.

## Development and packaging

Keep the Apell checkout at the sibling `../../apell` path for the local SDK dependency, as with Recorder. The normal layout is `apps/learning` alongside `apell`.

```sh
bun install
bun run dev
bun run test
bun run build
bun run pack
```

The development server binds to loopback. A standalone browser preview supports topic creation and persistence in IndexedDB. AI is available in Apell and is not simulated in the preview. Preview data is separate from native applet data.

`bun run pack` creates `artifacts/learning.apel` and `artifacts/learning.sha256`. Use Apell's **+ → Install from file** flow to install it. The stable applet ID is `learning`; updates retain its private data. Set `APELL_BIN` to a compatible packer if it is not available at the default sibling build path.

For an applets-only worktree, use a temporary build layout with a sibling Apell checkout or symlink. Keep machine-specific paths in local commands, never in the package manifest or lockfile. Build output, packages, dependencies, environment files, and screenshots are excluded from Git.

## Verification

Unit tests cover browser/native persistence, exact replay metadata, model routing, topic isolation, malformed model output, request bounds, cancellation, failed-save recovery, and native directory limits. The production UI is also checked in Firefox inside an opaque iframe using Apell's message bridge and content restrictions, with simulated AI/storage responses. The fixture reserves Apell’s host bar outside the applet and checks mobile, wide-window, and keyboard-sized layouts. These bridge checks do not exercise a live model provider or physical mobile device.

To repeat the browser checks, build the applet and run `bun scripts/verify-browser.ts` with `PLAYWRIGHT_MODULE` pointing to an installed `playwright-core` entrypoint. Its Firefox browser must be installed; optionally set `FIREFOX_BIN` to the Firefox executable. Screenshots and the check report are written to ignored `artifacts/browser-check/`.
