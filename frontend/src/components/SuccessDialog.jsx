export default function SuccessDialog({ message, onClose }) {
  if (!message) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card"
        role="alertdialog"
        aria-labelledby="success-dialog-title"
        aria-describedby="success-dialog-message"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="success-dialog-title">Successfully deleted</h2>
        <p id="success-dialog-message" className="muted-text">
          {message}
        </p>
        <div className="modal-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
