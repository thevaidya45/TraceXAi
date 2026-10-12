function timeText(frame) {
  if (!frame.timestamp) {
    return 'Time not available';
  }
  return frame.timestamp.clockTime
    ? `${frame.timestamp.clockTime} (${frame.timestamp.offsetLabel} into the recording)`
    : `${frame.timestamp.offsetLabel} into the recording`;
}

/**
 * One extracted CCTV still with its real metadata. The image is served through
 * an authenticated admin route, never a filesystem path.
 */
export default function EvidenceFrameCard({ frame, cameraLocation, onOpen }) {
  const time = timeText(frame);
  const alt = `CCTV frame from ${cameraLocation || 'the recording'} at ${time}: ${frame.eventLabel}`;

  return (
    <figure className="evidence-card">
      <button
        type="button"
        className="evidence-thumb"
        onClick={() => onOpen(frame)}
        aria-label={`Open evidence frame: ${frame.eventLabel} at ${time}`}
      >
        <img src={frame.imageUrl} alt={alt} loading="lazy" />
      </button>
      <figcaption>
        <p className="evidence-event">{frame.eventLabel}</p>
        <p className="evidence-time">{time}</p>
        {frame.trackingId ? (
          <p className="evidence-track">
            Anonymous track <strong>{frame.trackingId}</strong>
          </p>
        ) : null}
        <p className="evidence-meta">
          {frame.frameNumber !== null && frame.frameNumber !== undefined
            ? `Frame ${frame.frameNumber}`
            : 'Frame number unavailable'}
          {frame.width && frame.height ? ` · ${frame.width}×${frame.height}` : ''}
        </p>
        {frame.description ? <p className="evidence-note">{frame.description}</p> : null}
      </figcaption>
    </figure>
  );
}
