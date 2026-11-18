import { useEffect, useState } from 'react';
import { ActionDialog } from './ActionDialog';
import type { RecorderController } from '../lib/useRecorder';
import type { Channel } from '../lib/types';

export function ChannelNameDialog({
  channel,
  controller,
  onClose,
  onDirtyChange,
}: {
  channel?: Channel;
  controller: RecorderController;
  onClose: () => void;
  onDirtyChange: (id: string, dirty: boolean) => void;
}) {
  const initial = channel?.title ?? '';
  const [name, setName] = useState(initial);
  const [attempted, setAttempted] = useState(false);
  const dirty = name.trim() !== initial;
  const can_save = dirty && Boolean(name.trim()) && !controller.busy;
  useEffect(() => {
    onDirtyChange('channel-name', dirty);
    return () => onDirtyChange('channel-name', false);
  }, [dirty, onDirtyChange]);
  const save = async () => {
    if (!can_save) return;
    setAttempted(true);
    const saved = channel
      ? await controller.renameChannel(channel, name.trim())
      : await controller.createChannel(name.trim());
    if (saved) onClose();
  };
  const cancel = () => {
    if (controller.busy) return;
    if (attempted) controller.setError('');
    onClose();
  };
  return (
    <ActionDialog title={channel ? 'Rename channel' : 'New channel'} onCancel={cancel}>
      <form
        className="channel-name-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label>
          Channel name
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} />
        </label>
        {attempted && controller.error && <p role="alert">{controller.error}</p>}
        <div className="dialog-actions">
          <button type="button" className="button" onClick={cancel} disabled={controller.busy}>
            Cancel
          </button>
          <button className="button button-dark" disabled={!can_save}>
            {channel ? 'Save name' : 'Create channel'}
          </button>
        </div>
      </form>
    </ActionDialog>
  );
}
