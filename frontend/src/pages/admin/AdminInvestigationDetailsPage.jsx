import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import AppShell from '../../components/AppShell.jsx';
import CctvAnalysisPanel from '../../components/CctvAnalysisPanel.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import BackLink from '../../components/BackLink.jsx';
import RecordNotFound from '../../components/RecordNotFound.jsx';
import InvestigationAnalysis from '../../components/investigation/InvestigationAnalysis.jsx';
import { ADMIN_NAV } from '../../nav.js';
import { getErrorMessage, isNotFoundError } from '../../services/api.js';
import { formatReportDate, statusLabel, typeLabel } from '../../services/reportService.js';
import {
  addCctvFootage,
  closeInvestigation,
  extractEvidenceFrames,
  formatInvestigationDateTime,
  getCctvAnalyses,
  getInvestigation,
  getInvestigationReview,
  investigationStatusLabel,
  MODULE4_STATUS_OPTIONS,
  removeCctvFootage,
  retryCctvAnalysis,
  startCctvAnalysis,
  updateInvestigation
} from '../../services/investigationService.js';

const ANALYSIS_POLL_MS = 5000;

export default function AdminInvestigationDetailsPage() {
  const { id } = useParams();
  const [investigation, setInvestigation] = useState(null);
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('CREATED');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [askClose, setAskClose] = useState(false);
  const [cameraLocation, setCameraLocation] = useState('');
  const [recordedDate, setRecordedDate] = useState('');
  const [recordingStartTime, setRecordingStartTime] = useState('');
  const [recordingEndTime, setRecordingEndTime] = useState('');
  const [videoFile, setVideoFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [missing, setMissing] = useState(false);
  const [analyses, setAnalyses] = useState({});
  const [analysisBusy, setAnalysisBusy] = useState('');
  const [review, setReview] = useState(null);
  const [evidenceBusy, setEvidenceBusy] = useState('');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function applyInvestigation(next) {
    setInvestigation(next);
    setNotes(next.notes || '');
    setStatus(next.status);
  }

  const loadAnalyses = useCallback(async () => {
    try {
      const res = await getCctvAnalyses(id);
      if (!mounted.current) return;
      const byFootage = {};
      (res.data.analyses || []).forEach((row) => {
        byFootage[row.footageId] = row;
      });
      setAnalyses(byFootage);
      setInvestigation((current) =>
        current && res.data.investigationStatus && current.status !== res.data.investigationStatus
          ? { ...current, status: res.data.investigationStatus }
          : current
      );
    } catch {
      // Analysis results are supplementary; the case details stay usable.
    }
  }, [id]);

  // Module 6 reads the stored Module 5 results. It never starts detection or
  // tracking, so loading this is safe on every page open.
  const loadReview = useCallback(async () => {
    try {
      const res = await getInvestigationReview(id);
      if (!mounted.current) return;
      setReview(res.data);
    } catch {
      // The investigation stays usable even if the analysis view fails to load.
    }
  }, [id]);

  useEffect(() => {
    let active = true;
    setError('');
    setMissing(false);
    getInvestigation(id)
      .then((res) => {
        if (!active) return;
        applyInvestigation(res.data.investigation);
        loadAnalyses();
        loadReview();
      })
      .catch((err) => {
        if (active) {
          setInvestigation(null);
          if (isNotFoundError(err)) setMissing(true);
          else setError(getErrorMessage(err, 'Unable to load this investigation.'));
        }
      });
    return () => {
      active = false;
    };
  }, [id, loadAnalyses, loadReview]);

  const processing = Object.values(analyses).some((row) => row.status === 'PROCESSING');
  const extractingEvidence = Boolean(
    review
    && review.recordings.some((row) => row.evidence && row.evidence.status === 'EXTRACTING')
  );

  useEffect(() => {
    if (!processing && !extractingEvidence) return undefined;
    const timer = setInterval(() => {
      loadAnalyses();
      loadReview();
    }, ANALYSIS_POLL_MS);
    return () => clearInterval(timer);
  }, [processing, extractingEvidence, loadAnalyses, loadReview]);

  const closed = investigation && investigation.status === 'CLOSED';
  const caseStatus = investigation ? investigation.status : null;
  const caseBadge = closed || caseStatus === 'PROCESSING' ? 'badge-warn' : 'badge-ok';
  // While AI analysis owns the status, keep the current value visible in the picker.
  const statusOptions =
    caseStatus && !closed && !MODULE4_STATUS_OPTIONS.some((option) => option.value === caseStatus)
      ? [{ value: caseStatus, label: investigationStatusLabel(caseStatus) }, ...MODULE4_STATUS_OPTIONS]
      : MODULE4_STATUS_OPTIONS;

  async function handleSave(event) {
    event.preventDefault();
    if (!investigation || closed) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const payload = { notes };
      if (status !== 'CLOSED' && status !== investigation.status) {
        payload.status = status;
      }
      const res = await updateInvestigation(investigation.id, payload);
      applyInvestigation(res.data.investigation);
      loadReview();
      setSuccess('Investigation updated.');
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to update this investigation.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleClose() {
    if (!investigation) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await closeInvestigation(investigation.id);
      applyInvestigation(res.data.investigation);
      loadReview();
      setAskClose(false);
      setSuccess('Investigation closed.');
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to close this investigation.'));
      setAskClose(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleAddCctv(event) {
    event.preventDefault();
    if (!investigation || closed) return;
    if (!videoFile) {
      setError('Please select a recorded CCTV file.');
      return;
    }
    setUploading(true);
    setError('');
    setSuccess('');
    try {
      const formData = new FormData();
      formData.append('video', videoFile);
      formData.append('cameraLocation', cameraLocation);
      formData.append('recordedDate', recordedDate);
      if (recordingStartTime) formData.append('recordingStartTime', recordingStartTime);
      if (recordingEndTime) formData.append('recordingEndTime', recordingEndTime);
      const res = await addCctvFootage(investigation.id, formData);
      applyInvestigation(res.data.investigation);
      loadReview();
      setCameraLocation('');
      setRecordedDate('');
      setRecordingStartTime('');
      setRecordingEndTime('');
      setVideoFile(null);
      event.target.reset();
      setSuccess('CCTV footage added.');
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to add CCTV footage.'));
    } finally {
      setUploading(false);
    }
  }

  async function handleRemoveCctv(footageId) {
    if (!investigation || closed) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await removeCctvFootage(investigation.id, footageId);
      applyInvestigation(res.data.investigation);
      setSuccess('CCTV footage removed.');
      loadAnalyses();
      loadReview();
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to remove CCTV footage.'));
    } finally {
      setSaving(false);
    }
  }

  async function runAnalysis(footageId, retry) {
    if (!investigation || closed) return;
    setAnalysisBusy(footageId);
    setError('');
    setSuccess('');
    try {
      const res = retry
        ? await retryCctvAnalysis(investigation.id, footageId)
        : await startCctvAnalysis(investigation.id, footageId);
      setAnalyses((current) => ({ ...current, [footageId]: res.data.analysis }));
      setSuccess(res.data.message || 'AI analysis started.');
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to start AI analysis.'));
    } finally {
      if (mounted.current) setAnalysisBusy('');
      loadAnalyses();
      loadReview();
    }
  }

  async function handleExtractEvidence(footageId) {
    if (!investigation) return;
    setEvidenceBusy(footageId);
    setError('');
    setSuccess('');
    try {
      const res = await extractEvidenceFrames(investigation.id, footageId);
      setSuccess(res.data.message || 'Evidence frame extraction started.');
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to extract evidence frames.'));
    } finally {
      if (mounted.current) setEvidenceBusy('');
      loadReview();
    }
  }

  return (
    <AppShell items={ADMIN_NAV} active="Investigations" title="Investigation case">
      <p className="lede">
        <BackLink to="/admin/investigations">Back to investigations</BackLink>
        {investigation && investigation.item && investigation.item.id ? (
          <>
            {' · '}
            <Link to={`/admin/reports/${investigation.item.id}`}>Open report</Link>
          </>
        ) : null}
      </p>
      {error && <p className="form-error">{error}</p>}
      {success && <p className="form-success">{success}</p>}
      {!investigation && !error && !missing ? <p className="muted-text">Loading investigation...</p> : null}
      {missing ? <RecordNotFound title="Investigation not found" to="/admin/investigations" backLabel="Back to investigations" /> : null}

      {investigation ? (
        <section className="detail-layout">
          <article className="panel">
            <header className="detail-head">
              <div>
                <p className="muted-text" style={{ marginBottom: '0.35rem' }}>
                  Investigation
                </p>
                <h2>{investigation.caseId}</h2>
              </div>
              <span className={`badge ${caseBadge}`}>
                {investigationStatusLabel(investigation.status)}
              </span>
            </header>
            <dl className="detail-list">
              <div>
                <dt>Item</dt>
                <dd>
                  {investigation.item && investigation.item.id ? (
                    <Link to={`/admin/reports/${investigation.item.id}`}>
                      {investigation.item.itemName || 'Open report'}
                    </Link>
                  ) : '—'}
                  {investigation.item && investigation.item.reportType
                    ? ` · ${typeLabel(investigation.item.reportType)} · ${statusLabel(investigation.item.status)}`
                    : ''}
                </dd>
              </div>
              <div>
                <dt>Community</dt>
                <dd>
                  {investigation.community && investigation.community.id ? (
                    <Link to={`/admin/communities/${investigation.community.id}`}>
                      {investigation.community.name || 'Community'}
                    </Link>
                  ) : (investigation.community && investigation.community.name ? investigation.community.name : '—')}
                </dd>
              </div>
              <div>
                <dt>Created by</dt>
                <dd>{investigation.createdBy && investigation.createdBy.name ? investigation.createdBy.name : 'Admin'}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatInvestigationDateTime(investigation.createdAt)}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{formatInvestigationDateTime(investigation.updatedAt)}</dd>
              </div>
              {investigation.completedAt ? (
                <div>
                  <dt>Closed</dt>
                  <dd>{formatInvestigationDateTime(investigation.completedAt)}</dd>
                </div>
              ) : null}
            </dl>
          </article>

          <aside className="panel">
            <h2>CCTV footage</h2>
            {(investigation.cctv || []).length === 0 ? (
              <p className="muted-text">No recorded footage attached yet.</p>
            ) : (
              <ul className="cctv-list">
                {(investigation.cctv || []).map((clip) => (
                  <li key={clip.id} className="cctv-card">
                    <p>
                      <strong>{clip.cameraLocation}</strong>
                    </p>
                    <p className="muted-text">
                      {formatReportDate(clip.recordedDate)}
                      {clip.recordingStartTime || clip.recordingEndTime
                        ? ` · ${clip.recordingStartTime || '—'} – ${clip.recordingEndTime || '—'}`
                        : ''}
                    </p>
                    <p>File: {clip.filename}</p>
                    <video className="cctv-player" controls preload="metadata" src={clip.previewUrl}>
                      Preview is not available in this browser.
                    </video>
                    {!closed ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-small"
                        disabled={saving || analysisBusy === clip.id}
                        onClick={() => handleRemoveCctv(clip.id)}
                      >
                        Remove
                      </button>
                    ) : null}
                    <CctvAnalysisPanel
                      analysis={analyses[clip.id] || null}
                      busy={analysisBusy === clip.id}
                      disabled={closed}
                      onStart={() => runAnalysis(clip.id, false)}
                      onRetry={() => runAnalysis(clip.id, true)}
                    />
                  </li>
                ))}
              </ul>
            )}

            {!closed ? (
              <form className="cctv-form" onSubmit={handleAddCctv}>
                <h2>Add recorded CCTV</h2>
                <label className="field">
                  <span>Camera / location</span>
                  <input
                    value={cameraLocation}
                    onChange={(e) => setCameraLocation(e.target.value)}
                    required
                    maxLength="120"
                    placeholder="Library Entrance"
                  />
                </label>
                <label className="field">
                  <span>Recorded date</span>
                  <input type="date" value={recordedDate} onChange={(e) => setRecordedDate(e.target.value)} required />
                </label>
                <div className="form-grid">
                  <label className="field">
                    <span>Start time</span>
                    <input type="time" value={recordingStartTime} onChange={(e) => setRecordingStartTime(e.target.value)} />
                  </label>
                  <label className="field">
                    <span>End time</span>
                    <input type="time" value={recordingEndTime} onChange={(e) => setRecordingEndTime(e.target.value)} />
                  </label>
                </div>
                <label className="field">
                  <span>CCTV file</span>
                  <input
                    type="file"
                    accept="video/mp4,video/webm,.mp4,.webm"
                    onChange={(e) => setVideoFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
                    required
                  />
                  <span className="field-hint">MP4 or WebM, up to 500 MB.</span>
                </label>
                <button type="submit" className="btn btn-secondary" disabled={uploading || saving}>
                  {uploading ? 'Uploading...' : 'Add CCTV file'}
                </button>
              </form>
            ) : null}
          </aside>
        </section>
      ) : null}

      {investigation ? (
        <InvestigationAnalysis
          review={review}
          extractingFootageId={evidenceBusy}
          onExtract={handleExtractEvidence}
        />
      ) : null}

      {investigation ? (
        <section className="panel case-review-panel">
          <h2>Admin notes and case review</h2>
          <p className="module-note">
            Review the analysis above, record your own observations, then decide the case status. The
            AI analysis never changes the status on its own.
          </p>
          <form onSubmit={handleSave}>
            <label className="field">
              <span>Notes</span>
              <textarea
                rows="4"
                maxLength="2000"
                value={notes}
                disabled={closed || saving}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Admin observations for later review, for example: review north corridor entrance around 14:30. Do not name suspects."
              />
              <span className="field-hint">
                These are Admin observations. They are kept separate from the AI analysis above.
              </span>
            </label>
            {!closed ? (
              <label className="field">
                <span>Status</span>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  disabled={saving || processing}
                >
                  {statusOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {processing ? (
                  <span className="muted-text">Status is managed by AI analysis while it runs.</span>
                ) : null}
              </label>
            ) : null}
            {!closed ? (
              <div className="form-actions">
                <button type="submit" className="btn btn-primary" disabled={saving || uploading}>
                  {saving ? 'Saving...' : 'Update case'}
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={saving || uploading}
                  onClick={() => setAskClose(true)}
                >
                  Close investigation
                </button>
              </div>
            ) : (
              <p className="muted-text">
                This case is closed. The investigation, AI results, evidence frames, timeline, and
                notes are all kept on file.
              </p>
            )}
          </form>
        </section>
      ) : null}

      <ConfirmDialog
        open={askClose}
        title="Are you sure you want to close this investigation?"
        message="The case will stay on file. CCTV files and notes will not be deleted."
        confirmLabel="Close investigation"
        confirmingLabel="Closing..."
        confirming={saving}
        onCancel={() => {
          if (!saving) setAskClose(false);
        }}
        onConfirm={handleClose}
      />
    </AppShell>
  );
}
