import { useState } from 'react';
import { Link } from 'react-router-dom';
import { categoryLabel, statusLabel, typeLabel } from '../../services/reportService.js';
import EvidenceViewer from './EvidenceViewer.jsx';
import RecordingAnalysis from './RecordingAnalysis.jsx';

function ItemOverview({ item }) {
  if (!item) {
    return <p className="muted-text">The reported item for this investigation is unavailable.</p>;
  }

  return (
    <div className="item-overview">
      {item.imageUrl ? (
        <img className="item-overview-image" src={item.imageUrl} alt={`Photo of ${item.itemName}`} />
      ) : null}
      <div>
        <h3>
          <Link to={`/admin/reports/${item.id}`}>{item.itemName}</Link>
        </h3>
        <p className="muted-text">
          {categoryLabel(item.category)} · {typeLabel(item.reportType)} · {statusLabel(item.status)}
        </p>
        <p className="item-overview-description">{item.description}</p>
      </div>
    </div>
  );
}

/**
 * Module 6 — investigation analysis and results built from the Module 5
 * detection and tracking output that is already stored for this case.
 */
export default function InvestigationAnalysis({ review, extractingFootageId, onExtract }) {
  const [viewer, setViewer] = useState(null);

  if (!review) {
    return null;
  }

  const { recordings, summary } = review;

  function openFrame(recording, frame) {
    const frames = recording.evidence ? recording.evidence.frames : [];
    const index = frames.findIndex((row) => row.id === frame.id);
    setViewer({
      frames,
      index: index < 0 ? 0 : index,
      cameraLocation: recording.footage.cameraLocation
    });
  }

  return (
    <section className="panel analysis-panel">
      <header className="detail-head">
        <div>
          <p className="muted-text" style={{ marginBottom: '0.35rem' }}>
            Investigation analysis
          </p>
          <h2>Results and evidence</h2>
        </div>
      </header>

      <ItemOverview item={review.item} />

      {summary.recordingCount === 0 ? (
        <p className="muted-text">
          No CCTV reference is attached to this case yet, so there are no results to analyse.
        </p>
      ) : (
        <p className="muted-text">
          {summary.analysedCount} of {summary.recordingCount} recording
          {summary.recordingCount === 1 ? '' : 's'} analysed · {summary.evidenceFrameCount} evidence
          frame{summary.evidenceFrameCount === 1 ? '' : 's'} extracted
        </p>
      )}

      {recordings.map((recording) => (
        <RecordingAnalysis
          key={recording.footage.id}
          recording={recording}
          extracting={extractingFootageId === recording.footage.id}
          onExtract={onExtract}
          onOpenFrame={openFrame}
        />
      ))}

      {viewer ? (
        <EvidenceViewer
          frames={viewer.frames}
          index={viewer.index}
          cameraLocation={viewer.cameraLocation}
          onClose={() => setViewer(null)}
          onMove={(next) => setViewer((current) => ({ ...current, index: next }))}
        />
      ) : null}
    </section>
  );
}
