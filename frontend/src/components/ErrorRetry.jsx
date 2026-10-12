export default function ErrorRetry({ message, onRetry }) {
  if (!message) return null;
  return (
    <div className="error-retry" role="alert">
      <p className="form-error">{message}</p>
      {onRetry ? (
        <button type="button" className="btn btn-secondary btn-small" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
