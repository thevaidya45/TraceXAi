export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  confirming,
  confirmingLabel,
  confirmClassName,
  onConfirm,
  onCancel
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="modal-card"
        role="alertdialog"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="confirm-dialog-title">{title}</h2>
        <p id="confirm-dialog-message" className="muted-text">
          {message}
        </p>
        <div className="modal-actions confirm-actions">
          <button type="button" className="btn btn-secondary" disabled={confirming} onClick={onCancel}>
            {cancelLabel || 'Cancel'}
          </button>
          <button
            type="button"
            className={confirmClassName || 'btn btn-danger'}
            disabled={confirming}
            onClick={onConfirm}
          >
            {confirming ? confirmingLabel || 'Deleting...' : confirmLabel || 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
