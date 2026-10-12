function timeText(frame) {
  if (!frame || !frame.timestamp) {
    return null;
  }
  return frame.timestamp.clockTime || frame.timestamp.offsetLabel;
}

function Side({ label, frame, cameraLocation, onOpen, unavailableMessage }) {
  const time = timeText(frame);
  return (
    <figure className="compare-side">
      <p className="compare-label">{label}</p>
      <p className="compare-time">{time || 'Time unavailable'}</p>
      {frame ? (
        <button
          type="button"
          className="evidence-thumb"
          onClick={() => onOpen(frame)}
          aria-label={`Open ${label} frame at ${time}`}
        >
          <img
            src={frame.imageUrl}
            alt={`CCTV frame from ${cameraLocation || 'the recording'} at ${time}: ${label}`}
            loading="lazy"
          />
        </button>
      ) : (
        <p className="compare-empty">{unavailableMessage}</p>
      )}
    </figure>
  );
}

/** Side-by-side view of the scene before and after the estimated disappearance. */
export default function BeforeAfterCompare({ beforeAfter, cameraLocation, onOpen }) {
  if (!beforeAfter) {
    return null;
  }

  return (
    <>
      <div className="compare-grid">
        <Side
          label={beforeAfter.beforeLabel}
          frame={beforeAfter.before}
          cameraLocation={cameraLocation}
          onOpen={onOpen}
          unavailableMessage="Last-seen frame unavailable."
        />
        <p className="compare-divider" aria-hidden="true">
          vs
        </p>
        <Side
          label={beforeAfter.afterLabel}
          frame={beforeAfter.after}
          cameraLocation={cameraLocation}
          onOpen={onOpen}
          unavailableMessage="Post-disappearance frame unavailable."
        />
      </div>
      <p className="muted-text">{beforeAfter.note}</p>
    </>
  );
}
