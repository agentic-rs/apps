import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPlatform } from './platform';
import { createId, createRecording } from './recordings';
import { empty_library, errorMessage, RecorderLibrary, type RecordingEditFields } from './library';
import type {
  AudioStatus,
  Capabilities,
  CaptureDraft,
  Channel,
  RecorderPlatform,
  Recording,
} from './types';

const idle_audio: AudioStatus = {
  recording_state: 'idle',
  elapsed_ms: 0,
  playing: false,
  position_ms: 0,
  duration_ms: 0,
};
const empty_capabilities: Capabilities = {
  recording: false,
  import: false,
  sharing: false,
  playback: false,
};
const emptySubscribe = () => () => {};
const emptySnapshot = () => empty_library;

export function useRecorder() {
  const [platform, setPlatform] = useState<RecorderPlatform | null>(null);
  const [library, setLibrary] = useState<RecorderLibrary | null>(null);
  const state = useSyncExternalStore(
    library?.subscribe ?? emptySubscribe,
    library?.getSnapshot ?? emptySnapshot,
  );
  const [mode, setMode] = useState<'document' | 'clip'>('document');
  const [selected_id, setSelectedId] = useState<string | null>(null);
  const [selected_channel_id, setSelectedChannelId] = useState<string | null>(null);
  const [active_capture, setActiveCapture] = useState<CaptureDraft | null>(null);
  const [audio, setAudio] = useState<AudioStatus>(idle_audio);
  const [capabilities, setCapabilities] = useState<Capabilities>(empty_capabilities);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [initial_error, setInitialError] = useState('');
  const [playing_id, setPlayingId] = useState<string | null>(null);
  const action_lock = useRef(false);
  const capture = useRef<CaptureDraft | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    let active = true;
    let current: RecorderPlatform | null = null;
    let manager: RecorderLibrary | null = null;
    mounted.current = true;
    void (async () => {
      try {
        current = await createPlatform();
        if (!active) {
          current.dispose();
          return;
        }
        manager = new RecorderLibrary(current);
        setPlatform(current);
        setLibrary(manager);
        const [, supported] = await Promise.all([manager.load(), current.capabilities()]);
        if (!active) return;
        setCapabilities(supported);
        setSelectedChannelId(manager.getSnapshot().channels[0]?.id ?? null);
      } catch (error) {
        if (active) {
          if (manager) manager.setError(errorMessage(error));
          else setInitialError(errorMessage(error));
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      mounted.current = false;
      manager?.dispose();
      current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!platform || !library) return;
    let active = true;
    let audio_polling = false;
    let speech_polling = false;
    const poll = () => {
      if (!audio_polling) {
        audio_polling = true;
        void platform
          .status()
          .then((status) => {
            if (active) setAudio(status);
          })
          .catch(() => {})
          .finally(() => {
            audio_polling = false;
          });
      }
      if (!speech_polling) {
        speech_polling = true;
        void platform
          .speechStatus()
          .then((status) => {
            if (active) library.updateSpeech(status);
          })
          .catch(() => {})
          .finally(() => {
            speech_polling = false;
          });
      }
    };
    const timer = setInterval(poll, 700);
    poll();
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [platform, library]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (audio.recording_state !== 'idle' || state.pending_recording || state.job) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [audio.recording_state, state.pending_recording, state.job]);

  const setError = useCallback(
    (error: string) => {
      setInitialError('');
      if (library) library.setError(error);
      else setInitialError(error);
    },
    [library],
  );

  const run = useCallback(
    async <T>(
      action: (current: RecorderPlatform, manager: RecorderLibrary) => Promise<T>,
    ): Promise<T | undefined> => {
      if (!platform || !library || action_lock.current) return;
      action_lock.current = true;
      setBusy(true);
      setError('');
      try {
        return await action(platform, library);
      } catch (error) {
        if (mounted.current) library.setError(errorMessage(error));
      } finally {
        action_lock.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [platform, library, setError],
  );

  const destination = () => {
    if (mode === 'clip' && !state.channels.some((channel) => channel.id === selected_channel_id))
      throw new Error('Create or select a channel before recording.');
    return { mode, channel_id: mode === 'clip' ? selected_channel_id : null };
  };

  const selectSaved = (recording: Recording) => {
    // A capture can finish after navigation. Do not replace an editor the user
    // opened while recording; its unsaved draft belongs to that selection.
    if (recording.mode === 'document') setSelectedId((selected) => selected ?? recording.id);
  };

  const start = () =>
    run(async (current, manager) => {
      if (manager.getSnapshot().pending_recording)
        throw new Error('Save the pending recording first.');
      if (capture.current) throw new Error('Save the current recording first.');
      // Freeze destination before awaiting a microphone permission prompt.
      const target = destination();
      if (target.mode === 'document') setSelectedId(null);
      await current.pausePlayback();
      setPlayingId(null);
      const started = await current.start();
      const draft: CaptureDraft = {
        schema_version: 1,
        id: createId(),
        ...target,
        started_at: new Date().toISOString(),
        path: started.path,
        mime_type: started.mime_type,
      };
      capture.current = draft;
      setActiveCapture(draft);
      setAudio({ ...idle_audio, recording_state: 'recording' });
      try {
        await current.store.saveCapture(draft);
      } catch (error) {
        // Do not keep capturing without durable destination metadata.
        const asset = await current.stop();
        setAudio({ ...idle_audio, elapsed_ms: asset.duration_ms });
        capture.current = null;
        setActiveCapture(null);
        const recording = createRecording(asset, 'microphone', draft);
        selectSaved(recording);
        await manager.add(recording);
        throw new Error(
          `Recording stopped because its recovery information could not be saved. ${errorMessage(error)}`,
        );
      }
      setAudio(await current.status());
    });

  const pause = () =>
    run(async (current) => {
      if (audio.recording_state === 'paused') await current.resume();
      else await current.pause();
      setAudio(await current.status());
    });

  const stop = () =>
    run(async (current, manager) => {
      const draft = capture.current;
      if (!draft) throw new Error('There is no active recording to save.');
      let asset;
      try {
        asset = await current.stop();
      } catch (error) {
        const status = await current.status();
        setAudio(status);
        if (status.recording_state === 'idle') {
          capture.current = null;
          setActiveCapture(null);
          // Keep the journal: the native host may have finalized a recoverable file.
        }
        throw error;
      }
      setAudio({ ...idle_audio, elapsed_ms: asset.duration_ms });
      capture.current = null;
      setActiveCapture(null);
      const recording = createRecording(asset, 'microphone', draft);
      selectSaved(recording);
      await manager.add(recording);
    });

  const importAudio = () =>
    run(async (current, manager) => {
      if (manager.getSnapshot().pending_recording)
        throw new Error('Save the pending recording first.');
      const target = destination();
      if (target.mode === 'document') setSelectedId(null);
      const asset = await current.importAudio();
      if (!asset) return;
      const recording = createRecording(asset, 'import', target);
      selectSaved(recording);
      await manager.add(recording);
    });

  const retrySave = () => run((_current, manager) => manager.retrySave());
  const save = (recording: Recording, fields?: RecordingEditFields) =>
    run((_current, manager) => manager.saveEdit(recording, fields));
  const remove = (recording: Recording) =>
    run(async (current, manager) => {
      if (playing_id === recording.id) {
        await current.pausePlayback();
        setPlayingId(null);
      }
      await manager.remove(recording.id);
      if (selected_id === recording.id) setSelectedId(null);
    });

  const play = (recording: Recording) =>
    run(async (current) => {
      if (playing_id === recording.id && audio.playing) await current.pausePlayback();
      else {
        await current.play(recording.path);
        setPlayingId(recording.id);
      }
      setAudio(await current.status());
    });
  const seek = (recording: Recording, position_ms: number) =>
    run(async (current) => {
      if (playing_id !== recording.id) {
        await current.play(recording.path);
        await current.pausePlayback();
        setPlayingId(recording.id);
      }
      await current.seek(position_ms);
      setAudio(await current.status());
    });

  const transcribe = (recording: Recording, language?: string) =>
    run((_current, manager) => manager.enqueue(recording.id, language));
  const cancelTranscription = (recording: Recording) =>
    run((_current, manager) => manager.cancel(recording.id));
  const cancelSpeech = () =>
    run(async (current, manager) => {
      const job = manager.getSnapshot().job;
      if (job && job !== 'download') await manager.cancel(job);
      else await current.cancelSpeech();
    });
  // Downloads and recognition never occupy the recording action lock.
  const downloadModel = async () => {
    if (!library) return;
    try {
      await library.downloadModel();
    } catch (error) {
      library.setError(errorMessage(error));
    }
  };
  const shareAudio = (recording: Recording) => run((current) => current.shareAudio(recording));
  const shareTranscript = (recording: Recording) =>
    run((current) => current.shareTranscript(recording));
  const createChannel = (title: string) =>
    run(async (_current, manager) => {
      const channel = await manager.createChannel(title);
      setSelectedChannelId(channel.id);
      return channel;
    });
  const renameChannel = (channel: Channel, title: string) =>
    run((_current, manager) => manager.renameChannel(channel, title));
  const removeChannel = (channel: Channel) =>
    run(async (_current, manager) => {
      if (capture.current?.channel_id === channel.id)
        throw new Error('Save the current clip before deleting this channel.');
      await manager.removeChannel(channel.id);
      if (selected_channel_id === channel.id)
        setSelectedChannelId(manager.getSnapshot().channels[0]?.id ?? null);
    });
  const reload = () =>
    run(async (current, manager) => {
      if (capture.current || manager.getSnapshot().pending_recording || manager.getSnapshot().job)
        throw new Error('Finish the current recording or save operation before reloading.');
      await manager.load();
      setCapabilities(await current.capabilities());
      if (!manager.getSnapshot().channels.some((channel) => channel.id === selected_channel_id))
        setSelectedChannelId(manager.getSnapshot().channels[0]?.id ?? null);
    });

  return {
    platform,
    ...state,
    error: state.error || initial_error,
    mode,
    setMode,
    selected_id,
    setSelectedId,
    selected_channel_id,
    setSelectedChannelId,
    active_capture,
    audio,
    capabilities,
    loading,
    busy,
    setError,
    playing_id,
    start,
    pause,
    stop,
    importAudio,
    retrySave,
    save,
    remove,
    play,
    seek,
    downloadModel,
    transcribe,
    cancelTranscription,
    cancelSpeech,
    shareAudio,
    shareTranscript,
    createChannel,
    renameChannel,
    removeChannel,
    reload,
  };
}

export type RecorderController = ReturnType<typeof useRecorder>;
