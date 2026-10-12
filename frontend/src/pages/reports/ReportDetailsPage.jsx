import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import AppShell from '../../components/AppShell.jsx';
import BackLink from '../../components/BackLink.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import SuccessDialog from '../../components/SuccessDialog.jsx';
import RecordNotFound from '../../components/RecordNotFound.jsx';
import ReportForm from '../../components/ReportForm.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { EMPLOYEE_NAV, STUDENT_NAV } from '../../nav.js';
import { reportsBasePath } from '../../reportsPaths.js';
import { getErrorMessage, isNotFoundError } from '../../services/api.js';
import {
  categoryLabel,
  deleteMyReport,
  formatReportDate,
  getMyReport,
  statusLabel,
  typeLabel,
  updateMyReportStatus
} from '../../services/reportService.js';

export default function ReportDetailsPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const basePath = reportsBasePath(user && user.role);
  const nav = user && user.role === 'employee' ? EMPLOYEE_NAV : STUDENT_NAV;
  const [report, setReport] = useState(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const [notice, setNotice] = useState('');
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let active = true;
    setEditing(false);
    setError('');
    setMissing(false);
    getMyReport(id)
      .then((res) => {
        if (active) setReport(res.data.report);
      })
      .catch((err) => {
        if (active) {
          setReport(null);
          if (isNotFoundError(err)) {
            setMissing(true);
          } else {
            setError(getErrorMessage(err, 'Unable to load this report.'));
          }
        }
      });
    return () => {
      active = false;
    };
  }, [id]);

  async function changeStatus(status) {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await updateMyReportStatus(id, status);
      setReport(res.data.report);
      setSuccess('Status updated.');
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to update status.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!report) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      await deleteMyReport(report.id);
      setAskDelete(false);
      setNotice('The report was deleted successfully.');
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to delete this report.'));
      setAskDelete(false);
    } finally {
      setSaving(false);
    }
  }

  const communityName = user && user.community && user.community.name ? user.community.name : '';
  const isOwner = Boolean(report && report.isOwner);
  const canEdit = isOwner && report && report.status === 'active';

  return (
    <AppShell items={nav} active={isOwner ? 'My Reports' : 'Lost & Found'} title="Report details">
      <p className="lede">
        <BackLink to={isOwner ? `${basePath}/reports` : `${basePath}/lost-found`}>Back</BackLink>
      </p>
      {error && <p className="form-error">{error}</p>}
      {success && <p className="form-success">{success}</p>}

      {!report && !error && !missing ? <p className="muted-text">Loading report...</p> : null}
      {missing ? <RecordNotFound title="Report not found" to={`${basePath}/reports`} backLabel="Back to reports" /> : null}

      {report && editing ? (
        <section className="panel">
          <ReportForm
            reportType={report.reportType}
            basePath={basePath}
            existing={report}
            communityName={communityName}
          />
        </section>
      ) : null}

      {report && !editing ? (
        <section className="detail-layout">
          <article className="panel">
            <header className="detail-head">
              <div>
                <p className="muted-text" style={{ marginBottom: '0.35rem' }}>
                  {typeLabel(report.reportType)} · {categoryLabel(report.category)}
                </p>
                <h2>{report.itemName}</h2>
              </div>
              <span className={`badge ${report.status === 'active' ? 'badge-ok' : 'badge-warn'}`}>
                {statusLabel(report.status)}
              </span>
            </header>
            <dl className="detail-list">
              <div>
                <dt>Description</dt>
                <dd>{report.description}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{report.location}</dd>
              </div>
              <div>
                <dt>Community</dt>
                <dd>
                  <Link to={`${basePath}/community`}>
                    {report.community && report.community.name ? report.community.name : 'Community'}
                  </Link>
                </dd>
              </div>
              <div>
                <dt>Approximate date</dt>
                <dd>
                  {formatReportDate(report.approximateDate)}
                  {report.approximateTime ? ` · ${report.approximateTime}` : ''}
                </dd>
              </div>
              <div>
                <dt>Submitted</dt>
                <dd>{formatReportDate(report.createdAt)}</dd>
              </div>
              <div>
                <dt>Last updated</dt>
                <dd>{formatReportDate(report.updatedAt)}</dd>
              </div>
            </dl>
            <div className="form-actions" style={{ marginTop: '1.25rem' }}>
              <Link to={`${basePath}/sightings?itemId=${report.id}`} className="btn btn-secondary">
                View sightings
              </Link>
              <Link to={`${basePath}/sightings/new?itemId=${report.id}`} className="btn btn-secondary">
                Report a sighting
              </Link>
              {canEdit ? (
                <>
                  <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>
                    Edit report
                  </button>
                  {report.reportType === 'lost' ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={saving}
                      onClick={() => changeStatus('recovered')}
                    >
                      Mark recovered
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={saving}
                      onClick={() => changeStatus('claimed')}
                    >
                      Mark claimed
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={saving}
                    onClick={() => changeStatus('closed')}
                  >
                    Close report
                  </button>
                </>
              ) : null}
              {isOwner ? (
                <button type="button" className="btn btn-danger" disabled={saving} onClick={() => setAskDelete(true)}>
                  Delete report
                </button>
              ) : null}
            </div>
          </article>
          <aside className="panel">
            <h2>Photo</h2>
            {report.hasImage && report.imageUrl ? (
              <img className="report-photo" src={report.imageUrl} alt={`Photo of ${report.itemName}`} />
            ) : (
              <p className="muted-text">No photo attached.</p>
            )}
          </aside>
        </section>
      ) : null}
      <ConfirmDialog
        open={askDelete}
        title="Would you like to delete this report?"
        message={report ? `This will permanently remove “${report.itemName}”.` : ''}
        confirming={saving}
        onCancel={() => {
          if (!saving) setAskDelete(false);
        }}
        onConfirm={handleDelete}
      />
      <SuccessDialog
        message={notice}
        onClose={() => {
          setNotice('');
          navigate(`${basePath}/reports`, { replace: true });
        }}
      />
    </AppShell>
  );
}
