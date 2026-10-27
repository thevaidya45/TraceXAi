import { useState } from 'react';
import {
  analysisStatusBadge,
  analysisStatusLabel
} from '../services/investigationService.js';

const VISIBLE_TRACKS = 8;

function pointLabel(point) {
  if (!point) {
    return '—';
  }
  if (point.clockTime && point.offsetLabel) {
    return `${point.clockTime} (${point.offsetLabel})`;
  }
  return point.clockTime || point.offsetLabel;
}

function TrackTable({ tracks, caption }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? tracks : tracks.slice(0, VISIBLE_TRACKS);
  const hidden = tracks.length - visible.length;

  return (
    <div className="analysis-tracks">
      <table className="data-table data-table-compact">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Tracking ID</th>
            <th scope="col">First seen</th>
            <th scope="col">Last seen</th>
            <th scope="col">Frames</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((track) => (
            <tr key={track.trackingId}>
              <td>{track.trackingId}</td>
              <td>{pointLabel(track.firstSeen)}</td>
              <td>{pointLabel(track.lastSeen)}</td>
              <td>{track.framesTracked}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {hidden > 0 ? (
        <button type="button" className="btn btn-ghost btn-small" onClick={() => setExpanded(true)}>
          Show {hidden} more
        </button>
      ) : null}
    </div>
  );
}

function CompletedResults({ analysis }) {
  const { item, persons, statistics, video, model } = analysis;

  return (
    <>
      <dl className="analysis-facts">
        <div>
          <dt>Item last seen</dt>
          <dd>{analysis.lastSeenLabel}</dd>
        </div>
        <div>
          <dt>Estimated disappearance</dt>
          <dd>{analysis.disappearanceRangeLabel || analysis.disappearanceLabel}</dd>
        </div>
        <div>
          <dt>Missing duration</dt>
          <dd>{analysis.missingDurationLabel}</dd>
        </div>
      </dl>

      {analysis.clockNote ? <p className="muted-text">{analysis.clockNote}</p> : null}
      {item && item.note ? <p className="module-note">{item.note}</p> : null}

      {analysis.disappearanceCertainty ? (
        <p className="muted-text">
          Disappearance certainty: {analysis.disappearanceCertainty}
          {analysis.observedAbsenceLabel
            ? ` · absent for ${analysis.observedAbsenceLabel} of the recording`
            : ''}
        </p>
      ) : null}

      {item && item.detected ? (
        <section className="analysis-section">
          <h4>Item detections</h4>
          <p className="muted-text">
            Matched as {item.targetClasses.join(', ')} · {statistics.uniqueItemTracks} tracked
            appearance{statistics.uniqueItemTracks === 1 ? '' : 's'}
          </p>
          <TrackTable tracks={item.tracks} caption="Item tracking appearances" />
        </section>
      ) : null}

      <section className="analysis-section">
        <h4>Anonymous people tracking</h4>
        {persons && persons.uniqueCount > 0 ? (
          <>
            <p className="muted-text">
              {persons.uniqueCount} distinct movement track{persons.uniqueCount === 1 ? '' : 's'} in
              this recording. Tracking IDs are anonymous and are not identities.
            </p>
            <TrackTable tracks={persons.tracks} caption="Anonymous people tracking" />
          </>
        ) : (
          <p className="muted-text">No people were detected in this recording.</p>
        )}
      </section>

      <p className="analysis-meta">
        Sampled {statistics.framesSampled} frame
        {statistics.framesSampled === 1 ? '' : 's'}
        {video && video.durationLabel ? ` across ${video.durationLabel} of video` : ''}
        {video && video.frameInterval ? ` (every ${video.frameInterval} frames)` : ''}
        {model && model.name ? ` · ${model.name}` : ''}
        {model && model.confidenceThreshold
          ? ` at ${Math.round(model.confidenceThreshold * 100)}% confidence`
          : ''}
      </p>
    </>
  );
}

export default function CctvAnalysisPanel({ analysis, busy, disabled, onStart, onRetry }) {
  if (!analysis) {
    return null;
  }

  const { status } = analysis;

  return (
    <div className="analysis-block">
      <div className="analysis-head">
        <h3>AI investigation</h3>
        <span className={`badge ${analysisStatusBadge(status)}`}>{analysisStatusLabel(status)}</span>
      </div>

      {status === 'AVAILABLE' ? (
        <p className="muted-text">
          This recording has not been analysed yet. Analysis runs on the stored file and does not
          upload it again.
        </p>
      ) : null}

      {status === 'PROCESSING' ? (
        <p className="muted-text" role="status">
          Analysing this recording. Large files can take several minutes; results appear here
          automatically.
        </p>
      ) : null}

      {status === 'FAILED' && analysis.error ? <p className="form-error">{analysis.error}</p> : null}

      {status === 'COMPLETED' ? <CompletedResults analysis={analysis} /> : null}

      {!disabled && (analysis.canStart || analysis.canRetry) ? (
        <div className="form-actions">
          {analysis.canStart ? (
            <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={onStart}>
              {busy ? 'Starting...' : 'Start AI analysis'}
            </button>
          ) : null}
          {analysis.canRetry ? (
            <button type="button" className="btn btn-secondary btn-small" disabled={busy} onClick={onRetry}>
              {busy ? 'Starting...' : 'Retry analysis'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
