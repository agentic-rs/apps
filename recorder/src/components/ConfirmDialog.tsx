import { ActionDialog } from './ActionDialog';

export function ConfirmDialog({
  title,
  description,
  confirm_label,
  cancel_label = 'Cancel',
  onCancel,
  onConfirm,
}: {
  title: string;
  description: string;
  confirm_label: string;
  cancel_label?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ActionDialog title={title} description={description} onCancel={onCancel}>
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onCancel}>
          {cancel_label}
        </button>
        <button type="button" className="button button-danger" onClick={onConfirm}>
          {confirm_label}
        </button>
      </div>
    </ActionDialog>
  );
}
