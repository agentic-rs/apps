import { createChannel } from './recordings';
import type { Channel, RecorderPlatform, Recording, SpeechStatus } from './types';

export function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError')
    return 'Microphone access was denied. Enable it in your device settings and try again.';
  return error instanceof Error
    ? error.message
    : 'The operation could not be completed. Please try again.';
}

export interface RecordingEditFields {
  title: boolean;
  transcript: boolean;
}

export interface LibrarySnapshot {
  recordings: Recording[];
  channels: Channel[];
  pending_recording: Recording | null;
  speech: SpeechStatus;
  job: string | null;
  error: string;
  notice: string;
}

export const empty_library: LibrarySnapshot = {
  recordings: [],
  channels: [],
  pending_recording: null,
  speech: { model_ready: false, model_size_bytes: 0, busy: false, progress: 0, stage: 'idle' },
  job: null,
  error: '',
  notice: '',
};

/** Serializes metadata writes and owns the durable, single-worker speech queue. */
export class RecorderLibrary {
  private snapshot: LibrarySnapshot = { ...empty_library };
  private listeners = new Set<() => void>();
  private pending = new Map<string, Recording>();
  private deleting = new Set<string>();
  private writes: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private ready = false;
  private pumping = false;

  constructor(readonly platform: RecorderPlatform) {}

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish(change: Partial<LibrarySnapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    if (!this.disposed) this.listeners.forEach((listener) => listener());
  }

  setError = (error: string) => this.publish({ error, notice: '' });
  setNotice = (notice: string) => this.publish({ notice, error: '' });

  private transaction<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writes.then(operation, operation);
    this.writes = result.catch(() => {});
    return result;
  }

  find(id: string) {
    return this.snapshot.recordings.find((recording) => recording.id === id);
  }

  private replace(recording: Recording) {
    const recordings = this.snapshot.recordings.filter((item) => item.id !== recording.id);
    recordings.push(recording);
    recordings.sort(
      (left, right) =>
        right.created_at.localeCompare(left.created_at) || left.id.localeCompare(right.id),
    );
    this.publish({ recordings });
  }

  private async persist(recording: Recording) {
    // Make generated text and finalized audio visible even when storage is full.
    this.pending.set(recording.id, recording);
    this.replace(recording);
    this.publish({ pending_recording: this.pending.values().next().value ?? null });
    try {
      await this.transaction(() => this.platform.store.save(recording));
      if (this.pending.get(recording.id) === recording) this.pending.delete(recording.id);
    } finally {
      this.publish({ pending_recording: this.pending.values().next().value ?? null });
    }
  }

  async load() {
    this.ready = false;
    const recordings = await this.platform.store.list();
    const channels = await this.platform.store.listChannels();
    // A recovered clip can outlive its channel metadata; preserve its placement.
    for (const recording of recordings) {
      if (
        recording.mode !== 'clip' ||
        !recording.channel_id ||
        channels.some((channel) => channel.id === recording.channel_id)
      )
        continue;
      const channel = { ...createChannel('Recovered channel'), id: recording.channel_id };
      await this.platform.store.saveChannel(channel);
      channels.push(channel);
    }
    if (!channels.length) {
      const channel = createChannel('Notes');
      await this.platform.store.saveChannel(channel);
      channels.push(channel);
    }
    this.publish({ recordings, channels, speech: await this.platform.speechStatus() });
    // An interrupted native job cannot still own this new attached view.
    for (const recording of recordings) {
      if (recording.transcription_state === 'running') {
        await this.persist({
          ...recording,
          transcription_state: 'queued',
          transcription_error: null,
        });
      }
    }
    this.ready = true;
    this.schedule();
  }

  updateSpeech(speech: SpeechStatus) {
    this.publish({ speech });
    this.schedule();
  }

  async add(recording: Recording) {
    await this.persist(recording);
    this.setNotice(
      recording.mode === 'clip' ? 'Clip saved on this device.' : 'Document saved on this device.',
    );
    this.schedule();
  }

  async saveEdit(input: Recording, fields?: RecordingEditFields) {
    const latest = this.find(input.id);
    if (!latest || this.deleting.has(input.id)) throw new Error('This recording no longer exists.');
    const changed_text = fields?.transcript ?? input.transcript?.text !== latest.transcript?.text;
    const updated: Recording = {
      ...latest,
      title: fields?.title === false ? latest.title : input.title,
      transcript: changed_text ? input.transcript : latest.transcript,
      transcript_edited: latest.transcript_edited || changed_text,
      updated_at: new Date().toISOString(),
      transcription_revision: latest.transcription_revision + (changed_text ? 1 : 0),
      transcription_state: changed_text
        ? input.transcript
          ? 'complete'
          : 'idle'
        : latest.transcription_state,
      transcription_error: changed_text ? null : latest.transcription_error,
    };
    const cancelling = changed_text && this.snapshot.job === input.id;
    await Promise.all([
      this.persist(updated),
      cancelling ? this.platform.cancelSpeech() : Promise.resolve(),
    ]);
    this.setNotice('Changes saved.');
  }

  async retrySave() {
    for (const recording of [...this.pending.values()]) {
      if (!this.deleting.has(recording.id)) await this.persist(recording);
    }
    this.setNotice('Changes saved.');
    this.schedule();
  }

  async remove(id: string) {
    const recording = this.find(id);
    if (!recording) return;
    if (this.pending.has(id)) throw new Error('Save this recording before deleting it.');
    this.deleting.add(id);
    try {
      // Persist cancellation before deleting so a failed removal cannot strand a
      // cancelled native job in the durable running state.
      await this.cancel(id);
      await this.transaction(() => this.platform.store.remove(recording));
      this.publish({ recordings: this.snapshot.recordings.filter((item) => item.id !== id) });
      this.setNotice('Recording deleted.');
    } finally {
      this.deleting.delete(id);
    }
  }

  async createChannel(title: string) {
    const channel = createChannel(title);
    await this.transaction(() => this.platform.store.saveChannel(channel));
    this.publish({ channels: [...this.snapshot.channels, channel] });
    return channel;
  }

  async renameChannel(channel: Channel, title: string) {
    const updated = { ...channel, title: title.trim(), updated_at: new Date().toISOString() };
    await this.transaction(() => this.platform.store.saveChannel(updated));
    this.publish({
      channels: this.snapshot.channels.map((item) => (item.id === channel.id ? updated : item)),
    });
  }

  async removeChannel(id: string) {
    if (this.snapshot.recordings.some((recording) => recording.channel_id === id))
      throw new Error('Only empty channels can be deleted.');
    await this.transaction(() => this.platform.store.removeChannel(id));
    this.publish({ channels: this.snapshot.channels.filter((channel) => channel.id !== id) });
  }

  async enqueue(id: string, language?: string) {
    const recording = this.find(id);
    if (!recording || this.deleting.has(id)) return;
    if (this.snapshot.job === id) throw new Error('This recording is already being transcribed.');
    await this.persist({
      ...recording,
      transcription_state: 'queued',
      transcription_error: null,
      transcription_language: language || null,
      transcription_revision: recording.transcription_revision + 1,
      updated_at: new Date().toISOString(),
    });
    this.schedule();
  }

  async cancel(id: string) {
    const recording = this.find(id);
    if (!recording || !['queued', 'running'].includes(recording.transcription_state)) return;
    const updated: Recording = {
      ...recording,
      transcription_state: 'cancelled',
      transcription_error: null,
      transcription_revision: recording.transcription_revision + 1,
      updated_at: new Date().toISOString(),
    };
    await Promise.all([
      this.persist(updated),
      this.snapshot.job === id ? this.platform.cancelSpeech() : Promise.resolve(),
    ]);
  }

  async downloadModel() {
    if (this.snapshot.job || this.snapshot.speech.busy)
      throw new Error('Wait for the current speech operation to finish.');
    this.publish({ job: 'download', error: '', notice: '' });
    try {
      await this.platform.downloadModel();
      this.setNotice('The model is ready. Queued clips will transcribe on this device.');
    } finally {
      try {
        this.updateSpeech(await this.platform.speechStatus());
      } catch {
        /* Retain last status. */
      }
      this.publish({ job: null });
      this.schedule();
    }
  }

  private schedule() {
    if (!this.pumping) queueMicrotask(() => void this.pump());
  }

  private async pump() {
    if (
      this.disposed ||
      !this.ready ||
      this.pumping ||
      this.snapshot.job ||
      this.pending.size ||
      !this.platform.native ||
      !this.snapshot.speech.model_ready ||
      this.snapshot.speech.busy
    )
      return;
    const recording = [...this.snapshot.recordings]
      .filter((item) => item.transcription_state === 'queued' && !this.deleting.has(item.id))
      .sort(
        (left, right) =>
          (left.started_at ?? left.created_at).localeCompare(
            right.started_at ?? right.created_at,
          ) || left.id.localeCompare(right.id),
      )[0];
    if (!recording) return;
    this.pumping = true;
    this.publish({ job: recording.id });
    const revision = recording.transcription_revision;
    try {
      await this.persist({
        ...recording,
        transcription_state: 'running',
        transcription_error: null,
      });
      if (this.disposed || !this.isCurrent(recording.id, revision)) return;
      const transcript = await this.platform.transcribe(
        recording.path,
        recording.transcription_language ?? undefined,
      );
      const latest = this.isCurrent(recording.id, revision);
      if (this.disposed || !latest) return;
      await this.persist({
        ...latest,
        transcript,
        transcript_edited: false,
        transcription_state: 'complete',
        transcription_error: null,
        duration_ms:
          transcript.duration_ms && Number.isFinite(transcript.duration_ms)
            ? transcript.duration_ms
            : latest.duration_ms,
        updated_at: new Date().toISOString(),
      });
    } catch (error) {
      const latest = this.isCurrent(recording.id, revision);
      if (latest && !this.disposed) {
        const failed: Recording = {
          ...latest,
          transcription_state: 'failed',
          transcription_error: errorMessage(error),
        };
        try {
          await this.persist(failed);
        } catch (save_error) {
          this.setError(errorMessage(save_error));
        }
      } else if (!this.disposed && this.pending.has(recording.id))
        this.setError(errorMessage(error));
    } finally {
      try {
        this.updateSpeech(await this.platform.speechStatus());
      } catch {
        /* Retain last status. */
      }
      this.publish({ job: null });
      this.pumping = false;
      this.schedule();
    }
  }

  private isCurrent(id: string, revision: number) {
    const current = this.find(id);
    return current &&
      !this.deleting.has(id) &&
      current.transcription_revision === revision &&
      current.transcription_state === 'running'
      ? current
      : null;
  }

  dispose() {
    this.disposed = true;
    this.listeners.clear();
    if (this.snapshot.job) void this.platform.cancelSpeech().catch(() => {});
  }
}
