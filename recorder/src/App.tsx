import { ConfirmDialog } from './components/ConfirmDialog';
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
  const [leave, setLeave] = useState<(() => void) | null>(null);
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
    !controller.platform || controller.busy || Boolean(controller.pending_recording) || dirty;
  const navigate = (action: () => void) => {
    if (dirty) {
      setLeave(() => action);
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
          {controller.error && !model_open && (
            <div className="message-bar message-error" role="alert">
              <span>{controller.error}</span>
              {controller.open_failed ? (
                <button className="text-button" onClick={controller.retryOpen}>
                  Retry opening library
                </button>
              ) : (
                <button
                  className="icon-button"
                  aria-label="Dismiss error"
                  onClick={() => controller.setError('')}
                >
                  <Icon name="close" size={16} />
                </button>
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
            onSelectDocument={(id) =>
              id !== controller.selected_id && navigate(() => controller.setSelectedId(id))
            }
            onSelectChannel={(id) =>
              id !== controller.selected_channel_id &&
              navigate(() => controller.setSelectedChannelId(id))
            }
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
              <WorkspaceWelcome mode={controller.mode} />
            )}
            {controller.mode === 'clip' && <RecorderDock controller={controller} locked={locked} />}
          </div>
        </main>
        {controller.mode === 'document' && <RecorderDock controller={controller} locked={locked} />}
        <nav className="bottom-navigation" aria-label="App navigation">
          <button
            aria-pressed={controller.mode === 'document'}
            className={controller.mode === 'document' ? 'active' : ''}
            onClick={() =>
              controller.mode !== 'document' && navigate(() => controller.setMode('document'))
            }
          >
            <span className="nav-icon">
              <Icon name="text" size={22} />
            </span>
            <span>Documents</span>
          </button>
          <button
            aria-pressed={controller.mode === 'clip'}
            className={controller.mode === 'clip' ? 'active' : ''}
            onClick={() => controller.mode !== 'clip' && navigate(() => controller.setMode('clip'))}
          >
            <span className="nav-icon">
              <Icon name="chat" size={22} />
            </span>
            <span>Channels</span>
          </button>
          <button
            onClick={() => setModelOpen(true)}
            aria-label="Transcription settings"
            disabled={!controller.platform}
            aria-haspopup="dialog"
            aria-expanded={model_open}
            title="Transcription settings"
          >
            <span className="nav-icon">
              <Icon name="settings" size={22} />
            </span>
            <span>Settings</span>
          </button>
        </nav>
        {leave && (
          <ConfirmDialog
            title="Discard unsaved changes?"
            description="Leaving this editor will discard your changes."
            cancel_label="Keep editing"
            confirm_label="Discard changes"
            onCancel={() => setLeave(null)}
            onConfirm={() => {
              setLeave(null);
              leave();
            }}
          />
        )}
        {model_open && <ModelDialog controller={controller} onClose={() => setModelOpen(false)} />}
      </div>
    </div>
  );
}
