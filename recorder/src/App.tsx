import { useCallback, useEffect, useState } from 'react';
import { ChannelTimeline } from './components/ChannelTimeline';
import { Icon } from './components/Icon';
import { Library } from './components/Library';
import { ModelDialog } from './components/ModelDialog';
import { RecorderDock } from './components/RecorderDock';
import { RecordingDetail } from './components/RecordingDetail';
import { WorkspaceWelcome } from './components/WorkspaceWelcome';
import { useRecorder } from './lib/useRecorder';

export function App() {
  const controller = useRecorder();
  const native = controller.platform?.native ?? window.parent !== window;
  const [model_open, setModelOpen] = useState(false);
  const [dirty_ids, setDirtyIds] = useState<Set<string>>(() => new Set());
  const dirty = dirty_ids.size > 0;
  useEffect(() => {
    if (!dirty) return;
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnUnsaved);
    return () => window.removeEventListener('beforeunload', warnUnsaved);
  }, [dirty]);
  const onDirtyChange = useCallback((id: string, value: boolean) => {
    setDirtyIds((previous) => {
      if (previous.has(id) === value) return previous;
      const next = new Set(previous);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const selected =
    controller.mode === 'document'
      ? controller.recordings.find(
          (recording) => recording.id === controller.selected_id && recording.mode === 'document',
        )
      : undefined;
  const selected_channel =
    controller.mode === 'clip'
      ? controller.channels.find((channel) => channel.id === controller.selected_channel_id)
      : undefined;
  const recording_active = controller.audio.recording_state !== 'idle';
  const locked =
    controller.loading || controller.busy || Boolean(controller.pending_recording) || dirty;
  const navigate = (action: () => void) => {
    if (dirty) {
      controller.setError('Save or discard your changes before leaving this workspace.');
      return;
    }
    action();
  };
  return (
    <div className="app-scroll">
      <div
        className={`app ${native ? 'native-app' : ''} ${controller.mode === 'clip' ? 'channel-mode' : ''} ${recording_active ? 'capture-active' : ''} ${selected || selected_channel ? 'has-selection' : ''}`}
      >
        <header className="app-header">
          <div className="brand">
            <span className="brand-mark">
              <Icon name="wave" size={23} />
            </span>
            <div>
              <h1>Recorder</h1>
              <span className="brand-caption">A little room for your thoughts.</span>
            </div>
          </div>
          <button
            className={`model-status ${controller.speech.model_ready ? 'model-ready' : ''}`}
            onClick={() => setModelOpen(true)}
            aria-label="Transcription settings"
          >
            <span className="status-dot" />
            {controller.job === 'download'
              ? 'Setting up…'
              : controller.speech.model_ready
                ? 'Offline ready'
                : 'Set up transcription'}
            <Icon name="settings" size={15} />
          </button>
        </header>
        <nav className="mode-navigation" aria-label="Recording mode">
          <div className="mode-switch">
            <button
              aria-pressed={controller.mode === 'document'}
              className={controller.mode === 'document' ? 'active' : ''}
              onClick={() => navigate(() => controller.setMode('document'))}
            >
              <Icon name="text" size={17} />
              <span>Documents</span>
            </button>
            <button
              aria-pressed={controller.mode === 'clip'}
              className={controller.mode === 'clip' ? 'active' : ''}
              onClick={() => navigate(() => controller.setMode('clip'))}
            >
              <Icon name="chat" size={17} />
              <span>Channels</span>
            </button>
          </div>
          <p>
            {controller.mode === 'document'
              ? 'For interviews, meetings, and longer conversations'
              : 'For quick thoughts and everyday voice notes'}
          </p>
        </nav>
        {!controller.platform?.native && !controller.loading && (
          <div className="browser-banner">
            <Icon name="globe" size={16} />
            <span>
              Local browser preview · Audio stays in this browser. Transcription runs in Apell.
            </span>
          </div>
        )}
        {(controller.error || controller.notice) && (
          <div
            className={`message-bar ${controller.error ? 'message-error' : 'message-success'}`}
            role={controller.error ? 'alert' : 'status'}
          >
            <span>{controller.error || controller.notice}</span>
            {controller.error && (
              <div className="inline-actions">
                <button
                  className="text-button"
                  onClick={() => void controller.reload()}
                  disabled={
                    controller.busy ||
                    recording_active ||
                    Boolean(controller.pending_recording) ||
                    dirty
                  }
                >
                  Retry connection
                </button>
                <button
                  className="icon-button"
                  aria-label="Dismiss error"
                  onClick={() => controller.setError('')}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>
            )}
          </div>
        )}
        {controller.pending_recording && (
          <div className="recovery-bar" role="alert">
            <div>
              <strong>Your recording is waiting to be saved.</strong>
              <p>Keep this screen open and retry after checking available storage.</p>
            </div>
            <button
              className="button button-dark button-small"
              disabled={controller.busy || dirty}
              onClick={() => void controller.retrySave()}
            >
              Retry save
            </button>
          </div>
        )}
        <main className="workspace">
          <Library
            controller={controller}
            locked={locked}
            onSelectDocument={(id) => navigate(() => controller.setSelectedId(id))}
            onSelectChannel={(id) => navigate(() => controller.setSelectedChannelId(id))}
            onDirtyChange={onDirtyChange}
          />
          {selected ? (
            <RecordingDetail
              key={selected.id}
              recording={selected}
              controller={controller}
              onBack={() => navigate(() => controller.setSelectedId(null))}
              onModel={() => setModelOpen(true)}
              onDirtyChange={onDirtyChange}
            />
          ) : selected_channel ? (
            <ChannelTimeline
              key={selected_channel.id}
              channel={selected_channel}
              controller={controller}
              onBack={() => navigate(() => controller.setSelectedChannelId(null))}
              onModel={() => setModelOpen(true)}
              onDirtyChange={onDirtyChange}
            />
          ) : (
            <WorkspaceWelcome mode={controller.mode} native={native} />
          )}
        </main>
        <RecorderDock controller={controller} locked={locked} />
        <ModelDialog
          controller={controller}
          open={model_open}
          onClose={() => setModelOpen(false)}
        />
      </div>
    </div>
  );
}
