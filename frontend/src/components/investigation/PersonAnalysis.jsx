import { useState } from 'react';

const VISIBLE_ROWS = 10;

function pointLabel(point) {
  if (!point) {
    return '—';
  }
  return point.clockTime || point.offsetLabel;
}

/**
 * Anonymous tracking results with the temporal relationship to the estimated
 * disappearance. Track IDs are labels produced by tracking, not identities.
 */
export default function PersonAnalysis({ persons }) {
  const [expanded, setExpanded] = useState(false);

  if (!persons || persons.uniqueCount === 0) {
    return (
      <p className="muted-text">
        {(persons && persons.messages[0]) || 'No anonymous person tracks were found in this recording.'}
      </p>
    );
  }

  const rows = expanded ? persons.tracks : persons.tracks.slice(0, VISIBLE_ROWS);
  const hidden = persons.tracks.length - rows.length;
  // The reference point is the estimated disappearance when the analysis found
  // one, and the item's last detection otherwise.
  const fromDisappearance = persons.referenceFrom === 'DISAPPEARANCE';
  const referenceName = fromDisappearance
    ? 'the estimated disappearance'
    : 'the last detection of the item';
  const columnName = fromDisappearance ? 'estimated disappearance' : 'last detection';

  return (
    <>
      <p className="muted-text">
        {persons.uniqueCount} unique anonymous track{persons.uniqueCount === 1 ? '' : 's'} in this
        recording
        {persons.referenceFrom
          ? ` · ${persons.postDisappearanceCount} first detected at or after ${referenceName}`
          : ''}
        . Track IDs such as {persons.tracks[0].trackingId} are anonymous tracking labels and are not
        identities.
      </p>

      <div className="table-wrap">
        <table className="data-table data-table-compact">
          <caption className="sr-only">Anonymous person tracking results</caption>
          <thead>
            <tr>
              <th scope="col">Track ID</th>
              <th scope="col">First detected</th>
              <th scope="col">Last detected</th>
              <th scope="col">Tracking duration</th>
              <th scope="col">Time after {columnName}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((track) => (
              <tr key={track.trackingId}>
                <td>{track.trackingId}</td>
                <td>{pointLabel(track.firstSeen)}</td>
                <td>{pointLabel(track.lastSeen)}</td>
                <td>{track.trackingDurationLabel}</td>
                <td>
                  {track.relationLabel ? (
                    track.relationLabel.replace('First detected ', '')
                  ) : (
                    <span className="muted-text">Not applicable</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hidden > 0 ? (
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setExpanded(true)}>
          Show {hidden} more track{hidden === 1 ? '' : 's'}
        </button>
      ) : null}

      {persons.messages.map((message) => (
        <p key={message} className="muted-text">
          {message}
        </p>
      ))}
    </>
  );
}
