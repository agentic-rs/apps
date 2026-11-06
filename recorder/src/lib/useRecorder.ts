import { useCallback, useEffect, useRef, useState } from 'react';
import { createPlatform } from './platform';
import { createRecording } from './recordings';
import type { AudioStatus, Capabilities, RecorderPlatform, Recording, SpeechStatus } from './types';

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
const empty_speech: SpeechStatus = {
  model_ready: false,
  model_size_bytes: 0,
  busy: false,
  progress: 0,
  stage: 'idle',
};

function message(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError')
    return 'Microphone access was denied. Enable it in your device settings and try again.';
  return error instanceof Error
    ? error.message
    : 'The operation could not be completed. Please try again.';
}

export function useRecorder() {
  const [platform, setPlatform] = useState<RecorderPlatform | null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [selected_id, setSelectedId] = useState<string | null>(null);
  const [audio, setAudio] = useState<AudioStatus>(idle_audio);
  const [speech, setSpeech] = useState<SpeechStatus>(empty_speech);
  const [capabilities, setCapabilities] = useState<Capabilities>(empty_capabilities);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [job, setJob] = useState<'download' | string | null>(null);
  const [pending_recording, setPendingRecording] = useState<Recording | null>(null);
  const [playing_id, setPlayingId] = useState<string | null>(null);
  const action_lock = useRef(false);
  const job_lock = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    let active = true;
    let current: RecorderPlatform | null = null;
    mounted.current = true;
    void (async () => {
      try {
        current = await createPlatform();
        if (!active) {
          current.dispose();
          return;
        }
        setPlatform(current);
        const [saved, supported, model] = await Promise.all([
          current.store.list(),
          current.capabilities(),
          current.speechStatus(),
        ]);
        if (!active) return;
        setRecordings(saved);
        setCapabilities(supported);
        setSpeech(model);
      } catch (error) {
        if (active) setError(message(error));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      mounted.current = false;
      current?.dispose();
    };
  }, []);

  useEffect(() => {
    if (!platform) return;
    let active = true;
    let audio_polling = false;
    let speech_polling = false;
    const poll = () => {
      // Audio may wait for a native picker or be unavailable on desktop.
      // Keep speech progress independent of that operation.
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
            if (active) setSpeech(status);
          })
          .catch(() => {})
          .finally(() => {
            speech_polling = false;
          });
      }
    };
    const timer = setInterval(() => {
      void poll();
    }, 700);
    void poll();
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [platform]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (audio.recording_state !== 'idle' || pending_recording || job) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [audio.recording_state, pending_recording, job]);

  const run = useCallback(
    async (action: (current: RecorderPlatform) => Promise<void>) => {
      if (!platform || action_lock.current) return;
      action_lock.current = true;
      setBusy(true);
      setError('');
      setNotice('');
      try {
        await action(platform);
      } catch (error) {
        if (mounted.current) setError(message(error));
      } finally {
        action_lock.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [platform],
  );

  const addRecording = async (current: RecorderPlatform, recording: Recording) => {
    setPendingRecording(recording);
    await current.store.save(recording);
    setRecordings((previous) => [
      recording,
      ...previous.filter((item) => item.id !== recording.id),
    ]);
    setSelectedId(recording.id);
    setPendingRecording(null);
    setNotice('Recording saved on this device.');
  };

  const start = () =>
    run(async (current) => {
      await current.pausePlayback();
      setPlayingId(null);
      await current.start();
      setAudio(await current.status());
    });

  const pause = () =>
    run(async (current) => {
      if (audio.recording_state === 'paused') await current.resume();
      else await current.pause();
      setAudio(await current.status());
    });

  const stop = () =>
    run(async (current) => {
      const asset = await current.stop();
      setAudio({ ...idle_audio, elapsed_ms: asset.duration_ms });
      await addRecording(current, createRecording(asset, 'microphone'));
    });

  const importAudio = () =>
    run(async (current) => {
      const asset = await current.importAudio();
      if (asset) await addRecording(current, createRecording(asset, 'import'));
    });

  const retrySave = () =>
    run(async (current) => {
      if (pending_recording) await addRecording(current, pending_recording);
    });

  const save = (recording: Recording) =>
    run(async (current) => {
      if (pending_recording?.id === recording.id) setPendingRecording(recording);
      await current.store.save(recording);
      setRecordings((previous) =>
        previous.map((item) => (item.id === recording.id ? recording : item)),
      );
      setPendingRecording((pending) => (pending?.id === recording.id ? null : pending));
      setNotice('Changes saved.');
    });

  const remove = (recording: Recording) =>
    run(async (current) => {
      if (pending_recording?.id === recording.id) {
        throw new Error('Save this recording before deleting it.');
      }
      if (playing_id === recording.id) {
        await current.pausePlayback();
        setPlayingId(null);
      }
      await current.store.remove(recording);
      setRecordings((previous) => previous.filter((item) => item.id !== recording.id));
      setSelectedId(null);
      setNotice('Recording deleted.');
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

  const beginSpeech = async (
    kind: string,
    operation: (current: RecorderPlatform) => Promise<void>,
  ) => {
    if (!platform || job_lock.current || speech.busy) return;
    if (pending_recording) {
      setError('Save the pending recording before starting another transcription.');
      return;
    }
    job_lock.current = true;
    setJob(kind);
    setError('');
    setNotice('');
    try {
      await operation(platform);
    } catch (error) {
      setError(message(error));
    } finally {
      job_lock.current = false;
      setJob(null);
      try {
        setSpeech(await platform.speechStatus());
      } catch {
        /* Preserve last known status. */
      }
    }
  };

  const downloadModel = () =>
    beginSpeech('download', async (current) => {
      await current.downloadModel();
      setNotice('The language model is ready for offline transcription.');
    });

  const transcribe = (recording: Recording, language?: string) =>
    beginSpeech(recording.id, async (current) => {
      const transcript = await current.transcribe(recording.path, language);
      const updated = {
        ...recording,
        transcript,
        transcript_edited: false,
        duration_ms:
          transcript.duration_ms && Number.isFinite(transcript.duration_ms)
            ? transcript.duration_ms
            : recording.duration_ms,
      };
      // Keep generated text visible even if persistence fails, and expose Retry save.
      setRecordings((previous) =>
        previous.map((item) => (item.id === updated.id ? updated : item)),
      );
      setPendingRecording(updated);
      await current.store.save(updated);
      setPendingRecording(null);
      setNotice('Transcript saved on this device.');
    });

  const cancelSpeech = () =>
    run(async (current) => {
      await current.cancelSpeech();
    });
  const shareAudio = (recording: Recording) => run((current) => current.shareAudio(recording));
  const shareTranscript = (recording: Recording) =>
    run((current) => current.shareTranscript(recording));
  const reload = () =>
    run(async (current) => {
      const [saved, supported, model] = await Promise.all([
        current.store.list(),
        current.capabilities(),
        current.speechStatus(),
      ]);
      setRecordings(saved);
      setCapabilities(supported);
      setSpeech(model);
    });

  return {
    platform,
    recordings,
    selected_id,
    setSelectedId,
    audio,
    speech,
    capabilities,
    loading,
    busy,
    error,
    setError,
    notice,
    job,
    pending_recording,
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
    cancelSpeech,
    shareAudio,
    shareTranscript,
    reload,
  };
}

export type RecorderController = ReturnType<typeof useRecorder>;
