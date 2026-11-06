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
        <h1 className="sr-only">Recorder</h1>
        <div className="app-notices">
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
        </div>
        <main className="workspace">
          <Library
            controller={controller}
            locked={locked}
            onSelectDocument={(id) => navigate(() => controller.setSelectedId(id))}
            onSelectChannel={(id) => navigate(() => controller.setSelectedChannelId(id))}
            onDirtyChange={onDirtyChange}
          />
          <div className="workspace-content">
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
            {controller.mode === 'clip' && <RecorderDock controller={controller} locked={locked} />}
          </div>
        </main>
        {controller.mode === 'document' && <RecorderDock controller={controller} locked={locked} />}
        <nav className="bottom-navigation" aria-label="App navigation">
          <button
            aria-pressed={controller.mode === 'document'}
            className={controller.mode === 'document' ? 'active' : ''}
            onClick={() => navigate(() => controller.setMode('document'))}
          >
            <span className="nav-icon">
              <Icon name="text" size={22} />
            </span>
            <span>Documents</span>
          </button>
          <button
            aria-pressed={controller.mode === 'clip'}
            className={controller.mode === 'clip' ? 'active' : ''}
            onClick={() => navigate(() => controller.setMode('clip'))}
          >
            <span className="nav-icon">
              <Icon name="chat" size={22} />
            </span>
            <span>Channels</span>
          </button>
          <button
            className={controller.speech.model_ready ? 'model-ready' : ''}
            onClick={() => setModelOpen(true)}
            aria-label="Transcription settings"
            aria-haspopup="dialog"
            aria-expanded={model_open}
            title={
              controller.job === 'download'
                ? 'Setting up transcription…'
                : controller.speech.model_ready
                  ? 'On-device transcription ready'
                  : 'Set up on-device transcription'
            }
          >
            <span className="nav-icon">
              <Icon name="settings" size={22} />
              <span className="status-dot" />
            </span>
            <span>Settings</span>
          </button>
        </nav>
        <ModelDialog
          controller={controller}
          open={model_open}
          onClose={() => setModelOpen(false)}
        />
      </div>
    </div>
  );
}
