import { useEffect, useRef, useState } from 'react';

function timeText(frame) {
  if (!frame.timestamp) {
    return 'Time not available';
  }
  return frame.timestamp.clockTime
    ? `${frame.timestamp.clockTime} (${frame.timestamp.offsetLabel} into the recording)`
    : `${frame.timestamp.offsetLabel} into the recording`;
}

/**
 * Full-size evidence viewer. Admins can move between the frames of one
 * recording, zoom, and return to the investigation details behind it.
 */
export default function EvidenceViewer({ frames, index, cameraLocation, onClose, onMove }) {
  const [zoomed, setZoomed] = useState(false);
  const cardRef = useRef(null);
  const frame = frames[index];

  useEffect(() => {
    setZoomed(false);
  }, [index]);

  useEffect(() => {
    if (cardRef.current) {
      cardRef.current.focus();
    }
  }, []);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        onClose();
      } else if (event.key === 'ArrowRight' && index < frames.length - 1) {
        onMove(index + 1);
      } else if (event.key === 'ArrowLeft' && index > 0) {
        onMove(index - 1);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [frames.length, index, onClose, onMove]);

  if (!frame) {
    return null;
  }

  const time = timeText(frame);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="evidence-viewer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-viewer-title"
        tabIndex={-1}
        ref={cardRef}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="evidence-viewer-head">
          <div>
            <h2 id="evidence-viewer-title">{frame.eventLabel}</h2>
            <p className="muted-text">
              {time}
              {frame.trackingId ? ` · anonymous track ${frame.trackingId}` : ''}
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>
            Close
          </button>
        </header>

        <div className={`evidence-viewer-image${zoomed ? ' is-zoomed' : ''}`}>
          <img
            src={frame.imageUrl}
            alt={`CCTV frame from ${cameraLocation || 'the recording'} at ${time}: ${frame.eventLabel}`}
          />
        </div>

        {frame.description ? <p className="evidence-note">{frame.description}</p> : null}
        <p className="evidence-meta">
          {frame.frameNumber !== null && frame.frameNumber !== undefined
            ? `Frame ${frame.frameNumber}`
            : 'Frame number unavailable'}
          {frame.width && frame.height ? ` · ${frame.width}×${frame.height}` : ''}
          {cameraLocation ? ` · ${cameraLocation}` : ''}
        </p>

        <div className="evidence-viewer-actions">
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={index === 0}
            onClick={() => onMove(index - 1)}
          >
            Previous
          </button>
          <span className="muted-text" role="status">
            Frame {index + 1} of {frames.length}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={index >= frames.length - 1}
            onClick={() => onMove(index + 1)}
          >
            Next
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-small"
            aria-pressed={zoomed}
            onClick={() => setZoomed((current) => !current)}
          >
            {zoomed ? 'Fit to screen' : 'Zoom in'}
          </button>
        </div>
      </div>
    </div>
  );
}
