import { useState } from 'react';

const VISIBLE_TRACKS = 6;

function pointLabel(point) {
  return point ? point.clockTime || point.offsetLabel : null;
}

/** First and, where available, last detection of each anonymous track. */
export default function PersonTimeline({ persons }) {
  const [expanded, setExpanded] = useState(false);

  if (!persons || persons.tracks.length === 0) {
    return <p className="muted-text">No anonymous person tracks were found in this recording.</p>;
  }

  const tracks = expanded ? persons.tracks : persons.tracks.slice(0, VISIBLE_TRACKS);
  const hidden = persons.tracks.length - tracks.length;

  return (
    <>
      <ul className="person-timeline">
        {tracks.map((track) => (
          <li key={track.trackingId}>
            <p className="person-timeline-id">{track.trackingId}</p>
            <ul>
              {pointLabel(track.firstSeen) ? (
                <li>
                  <span className="person-timeline-time">{pointLabel(track.firstSeen)}</span>
                  First detected
                </li>
              ) : null}
              {pointLabel(track.lastSeen) ? (
                <li>
                  <span className="person-timeline-time">{pointLabel(track.lastSeen)}</span>
                  Last detected
                </li>
              ) : null}
            </ul>
            {track.relationLabel ? <p className="muted-text">{track.relationLabel}.</p> : null}
          </li>
        ))}
      </ul>
      {hidden > 0 ? (
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setExpanded(true)}>
          Show {hidden} more track{hidden === 1 ? '' : 's'}
        </button>
      ) : null}
    </>
  );
}
