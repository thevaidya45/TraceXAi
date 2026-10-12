import { formatReportDate } from '../../services/reportService.js';
import {
  analysisStatusBadge,
  analysisStatusLabel,
  evidenceStatusBadge,
  evidenceStatusLabel,
  formatInvestigationDateTime
} from '../../services/investigationService.js';
import BeforeAfterCompare from './BeforeAfterCompare.jsx';
import EvidenceFrameCard from './EvidenceFrameCard.jsx';
import InvestigationTimeline from './InvestigationTimeline.jsx';
import PersonAnalysis from './PersonAnalysis.jsx';
import PersonTimeline from './PersonTimeline.jsx';

function Section({ title, children }) {
  return (
    <section className="analysis-section">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function ItemAnalysis({ itemAnalysis }) {
  return (
    <>
      <dl className="analysis-facts">
        <div>
          <dt>Item last seen</dt>
          <dd>{itemAnalysis.lastSeenLabel}</dd>
        </div>
        <div>
          <dt>Estimated disappearance</dt>
          <dd>
            {itemAnalysis.disappearanceRange
              ? itemAnalysis.disappearanceRange.label
              : itemAnalysis.disappearanceLabel}
          </dd>
        </div>
        <div>
          <dt>{itemAnalysis.disappearance ? 'Estimated missing duration' : 'Missing duration'}</dt>
          <dd>{itemAnalysis.missingDurationLabel}</dd>
        </div>
      </dl>
      {itemAnalysis.disappearanceRange ? (
        <p className="muted-text">
          The item was absent from every sampled frame after {itemAnalysis.lastSeen.label}; absence
          was confirmed at {itemAnalysis.disappearance.label}.
        </p>
      ) : null}
      {itemAnalysis.certaintyLabel ? (
        <p className="muted-text">Confidence in the disappearance point: {itemAnalysis.certaintyLabel}.</p>
      ) : null}
      {itemAnalysis.messages.map((message) => (
        <p key={message} className="muted-text">
          {message}
        </p>
      ))}
    </>
  );
}

/**
 * Module 6 analysis for one recorded CCTV reference. Everything shown here is
 * read from the stored Module 5 result; nothing is re-processed on render.
 */
export default function RecordingAnalysis({ recording, extracting, onExtract, onOpenFrame }) {
  const { footage, evidence, itemAnalysis, persons, timeline, reviewWindow, recommendation } = recording;
  const personFrames = evidence ? evidence.byType.PERSON_FIRST_APPEARANCE : [];
  const orderedFrames = evidence ? evidence.frames : [];

  return (
    <article className="recording-analysis">
      <header className="recording-head">
        <div>
          <h3>{footage.cameraLocation}</h3>
          <p className="muted-text">
            {formatReportDate(footage.recordedDate)}
            {footage.recordingStartTime || footage.recordingEndTime
              ? ` · ${footage.recordingStartTime || '—'} – ${footage.recordingEndTime || '—'}`
              : ''}
            {' · '}
            {footage.filename}
          </p>
        </div>
        <span className={`badge ${analysisStatusBadge(recording.processingStatus)}`}>
          {analysisStatusLabel(recording.processingStatus)}
        </span>
      </header>

      {!recording.analysisReady ? (
        <>
          <p className="muted-text" role="status">
            {recording.statusMessage}
          </p>
          {recording.error ? <p className="form-error">{recording.error}</p> : null}
        </>
      ) : (
        <>
          <Section title="Item analysis">
            <ItemAnalysis itemAnalysis={itemAnalysis} />
          </Section>

          <Section title="Evidence frames">
            <p className="evidence-status">
              <span className={`badge ${evidenceStatusBadge(evidence.status)}`}>
                {evidenceStatusLabel(evidence.status)}
              </span>
              {evidence.extractedAt ? (
                <span className="muted-text">
                  Extracted {formatInvestigationDateTime(evidence.extractedAt)}
                </span>
              ) : null}
            </p>
            {evidence.message ? (
              <p className={evidence.status === 'FAILED' ? 'form-error' : 'muted-text'} role="status">
                {evidence.message}
              </p>
            ) : null}
            {orderedFrames.length > 0 ? (
              <div className="evidence-grid">
                {orderedFrames
                  .filter((frame) => frame.evidenceType !== 'PERSON_FIRST_APPEARANCE')
                  .map((frame) => (
                    <EvidenceFrameCard
                      key={frame.id}
                      frame={frame}
                      cameraLocation={footage.cameraLocation}
                      onOpen={() => onOpenFrame(recording, frame)}
                    />
                  ))}
              </div>
            ) : null}
            {evidence.canExtract ? (
              <div className="form-actions">
                <button
                  type="button"
                  className="btn btn-secondary btn-small"
                  disabled={extracting}
                  onClick={() => onExtract(footage.id)}
                >
                  {extracting
                    ? 'Starting...'
                    : evidence.status === 'FAILED'
                      ? 'Retry evidence extraction'
                      : 'Extract evidence frames'}
                </button>
              </div>
            ) : null}
          </Section>

          {recording.beforeAfter ? (
            <Section title="Before / after">
              <BeforeAfterCompare
                beforeAfter={recording.beforeAfter}
                cameraLocation={footage.cameraLocation}
                onOpen={(frame) => onOpenFrame(recording, frame)}
              />
            </Section>
          ) : null}

          <Section title="Anonymous person analysis">
            <PersonAnalysis persons={persons} />
            {personFrames.length > 0 ? (
              <>
                <h5 className="subsection-title">Person first-appearance evidence</h5>
                <div className="evidence-grid">
                  {personFrames.map((frame) => (
                    <EvidenceFrameCard
                      key={frame.id}
                      frame={frame}
                      cameraLocation={footage.cameraLocation}
                      onOpen={() => onOpenFrame(recording, frame)}
                    />
                  ))}
                </div>
              </>
            ) : persons.postDisappearanceCount > 0 && evidence.status === 'COMPLETED' ? (
              <p className="muted-text">Evidence frame unavailable.</p>
            ) : null}
          </Section>

          {persons.tracks.length > 0 ? (
            <Section title="Person timeline">
              <PersonTimeline persons={persons} />
            </Section>
          ) : null}

          <Section title="Investigation timeline">
            <InvestigationTimeline timeline={timeline} />
          </Section>

          <Section title="Smart review window">
            {reviewWindow.available ? (
              <div className="review-window">
                <p className="review-window-range">{reviewWindow.windowLabel}</p>
                <p className="muted-text">
                  {reviewWindow.durationLabel ? `${reviewWindow.durationLabel} of footage. ` : ''}
                  {reviewWindow.reason}
                </p>
                <p className="muted-text">{reviewWindow.note}</p>
                <span className="badge badge-warn">Admin review required</span>
              </div>
            ) : (
              <p className="muted-text">{reviewWindow.message}</p>
            )}
          </Section>

          <Section title={recommendation.title}>
            <div className="recommendation">
              <p>{recommendation.summary}</p>
              <p className="muted-text">{recommendation.disclaimer}</p>
              <span className="badge badge-warn">Admin review required</span>
            </div>
          </Section>

          <p className="analysis-meta">
            Analysed {formatInvestigationDateTime(recording.completedAt)}
            {recording.video && recording.video.durationLabel
              ? ` · ${recording.video.durationLabel} of video`
              : ''}
            {recording.statistics ? ` · ${recording.statistics.framesSampled} frames sampled` : ''}
            {recording.model && recording.model.name ? ` · ${recording.model.name}` : ''}
          </p>
        </>
      )}
    </article>
  );
}
