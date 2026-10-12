import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import AppShell from '../../components/AppShell.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import SuccessDialog from '../../components/SuccessDialog.jsx';
import BackLink from '../../components/BackLink.jsx';
import RecordNotFound from '../../components/RecordNotFound.jsx';
import { ADMIN_NAV } from '../../nav.js';
import { getCommunities } from '../../services/communityService.js';
import { getErrorMessage, isNotFoundError } from '../../services/api.js';
import {
  categoryLabel,
  deleteAdminReport,
  formatReportDate,
  getAdminReport,
  statusLabel,
  typeLabel,
  sendCommunityEmailAlert,
  updateAdminReportStatus
} from '../../services/reportService.js';

function statusOptions(reportType) {
  if (reportType === 'lost') {
    return [
      { value: 'active', label: 'Active' },
      { value: 'recovered', label: 'Recovered' },
      { value: 'closed', label: 'Closed' },
      { value: 'invalid', label: 'Invalid' }
    ];
  }
  return [
    { value: 'active', label: 'Active' },
    { value: 'claimed', label: 'Claimed' },
    { value: 'closed', label: 'Closed' },
    { value: 'invalid', label: 'Invalid' }
  ];
}

export default function AdminReportDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  const [openInvestigation, setOpenInvestigation] = useState(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const [notice, setNotice] = useState('');
  const [askEmail, setAskEmail] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [communities, setCommunities] = useState([]);
  const [selectedCommunityIds, setSelectedCommunityIds] = useState([]);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let active = true;
    setError('');
    setMissing(false);
    Promise.all([getAdminReport(id), getCommunities()])
      .then(([reportRes, communityRes]) => {
        if (!active) return;
        const nextReport = reportRes.data.report;
        setReport(nextReport);
        setOpenInvestigation(reportRes.data.investigation || null);
        setStatus(nextReport.status);
        const list = communityRes.data.communities || [];
        setCommunities(list);
        const reportCommunityId = nextReport.community && nextReport.community.id ? nextReport.community.id : '';
        setSelectedCommunityIds(reportCommunityId ? [reportCommunityId] : list.map((item) => item.id));
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

  async function handleStatus(event) {
    event.preventDefault();
    if (!report) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await updateAdminReportStatus(report.id, status);
      setReport(res.data.report);
      setStatus(res.data.report.status);
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
      await deleteAdminReport(report.id);
      setAskDelete(false);
      setNotice('The report was deleted successfully.');
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to delete this report.'));
      setAskDelete(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleSendEmail() {
    if (!report) return;
    if (!selectedCommunityIds.length) {
      setError('Please select at least one community.');
      setAskEmail(false);
      return;
    }
    setSendingEmail(true);
    setError('');
    setSuccess('');
    try {
      const res = await sendCommunityEmailAlert(report.id, selectedCommunityIds);
      setReport(res.data.report);
      setAskEmail(false);
      setSuccess(res.data.message || 'Community email alert sent.');
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to send the community email.'));
      setAskEmail(false);
    } finally {
      setSendingEmail(false);
    }
  }

  function toggleCommunity(communityId) {
    setSelectedCommunityIds((current) => (
      current.includes(communityId)
        ? current.filter((id) => id !== communityId)
        : [...current, communityId]
    ));
  }

  const emailState = report && report.communityEmailNotification ? report.communityEmailNotification : null;
  const emailSent = Boolean(emailState && emailState.sent);
  const sendCount = emailState && Number(emailState.sendCount) ? Number(emailState.sendCount) : emailSent ? 1 : 0;
  const remainingAttempts = emailState && emailState.remainingAttempts != null
    ? Number(emailState.remainingAttempts)
    : Math.max(0, 2 - sendCount);
  const canSend = remainingAttempts > 0;
  const sentCommunityNames = emailState && Array.isArray(emailState.sentCommunityNames)
    ? emailState.sentCommunityNames
    : [];
  const selectedCommunityNames = communities
    .filter((item) => selectedCommunityIds.includes(item.id))
    .map((item) => item.name);

  return (
    <AppShell items={ADMIN_NAV} active="Lost & Found" title="Report details">
      <p className="lede">
        <BackLink to="/admin/reports">Back to all reports</BackLink>
      </p>
      {error && <p className="form-error">{error}</p>}
      {success && <p className="form-success">{success}</p>}
      {!report && !error && !missing ? <p className="muted-text">Loading report...</p> : null}
      {missing ? <RecordNotFound title="Report not found" to="/admin/reports" backLabel="Back to reports" /> : null}

      {report ? (
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
                  {report.community && report.community.id ? (
                    <Link to={`/admin/communities/${report.community.id}`}>
                      {report.community.name || 'Community'}
                    </Link>
                  ) : '—'}
                </dd>
              </div>
              <div>
                <dt>Reporter</dt>
                <dd>
                  {report.reporter && report.reporter.id ? (
                    <Link to={`/admin/users/${report.reporter.id}`}>
                      {report.reporter.name || 'Reporter'}
                      {report.reporter.email ? ` · ${report.reporter.email}` : ''}
                    </Link>
                  ) : (
                    <>
                      {report.reporter && report.reporter.name ? report.reporter.name : '—'}
                      {report.reporter && report.reporter.email ? ` · ${report.reporter.email}` : ''}
                    </>
                  )}
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
            </dl>
            <form className="status-form" onSubmit={handleStatus}>
              <label className="field">
                <span>Manage status</span>
                <select value={status} onChange={(e) => setStatus(e.target.value)}>
                  {statusOptions(report.reportType).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Update status'}
              </button>
              <button type="button" className="btn btn-danger" disabled={saving} onClick={() => setAskDelete(true)}>
                Delete report
              </button>
            </form>
          </article>
          <aside className="panel">
            <h2>Photo</h2>
            {report.hasImage && report.imageUrl ? (
              <img className="report-photo" src={report.imageUrl} alt={`Photo of ${report.itemName}`} />
            ) : (
              <p className="muted-text">No photo attached.</p>
            )}
            <h2 style={{ marginTop: '1.5rem' }}>Community Email Alert</h2>
            <dl className="detail-list">
              <div>
                <dt>Community</dt>
                <dd>{report.community && report.community.name ? report.community.name : '—'}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{emailSent ? 'SENT' : 'NOT SENT'}</dd>
              </div>
              <div>
                <dt>Send attempts</dt>
                <dd>{sendCount} of 2 used{remainingAttempts > 0 ? ` · ${remainingAttempts} remaining` : ''}</dd>
              </div>
              {emailSent ? (
                <>
                  <div>
                    <dt>Sent at</dt>
                    <dd>{emailState.sentAt ? new Date(emailState.sentAt).toLocaleString() : '—'}</dd>
                  </div>
                  <div>
                    <dt>Sent by</dt>
                    <dd>{emailState.sentBy || '—'}</dd>
                  </div>
                  <div>
                    <dt>Communities emailed</dt>
                    <dd>{sentCommunityNames.length ? sentCommunityNames.join(', ') : '—'}</dd>
                  </div>
                  <div>
                    <dt>Recipients</dt>
                    <dd>{emailState.recipientCount}</dd>
                  </div>
                </>
              ) : null}
            </dl>
            <fieldset className="community-pick" disabled={!canSend || sendingEmail}>
              <legend>Send to communities</legend>
              <p className="field-hint">The item’s community is selected by default. You can include other communities.</p>
              <div className="community-pick-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={() => setSelectedCommunityIds(communities.map((item) => item.id))}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-small"
                  onClick={() => setSelectedCommunityIds(report.community && report.community.id ? [report.community.id] : [])}
                >
                  Item community only
                </button>
              </div>
              <ul className="community-pick-list">
                {communities.map((community) => {
                  const isItemCommunity = report.community && report.community.id === community.id;
                  return (
                    <li key={community.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedCommunityIds.includes(community.id)}
                          onChange={() => toggleCommunity(community.id)}
                        />
                        <span>
                          {community.name}
                          {isItemCommunity ? ' (item community)' : ''}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
            <div className="form-actions" style={{ marginTop: '1rem' }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canSend || sendingEmail || selectedCommunityIds.length === 0}
                onClick={() => setAskEmail(true)}
              >
                {!canSend ? 'Email Sent' : emailSent ? 'Send Email Again' : 'Send Email Alert'}
              </button>
              {report.id ? (
                <Link to={`/admin/sightings?itemId=${report.id}`} className="btn btn-secondary">
                  View sightings
                </Link>
              ) : null}
              {openInvestigation && openInvestigation.id ? (
                <Link to={`/admin/investigations/${openInvestigation.id}`} className="btn btn-secondary">
                  View investigation
                </Link>
              ) : report.status === 'active' ? (
                <Link to={`/admin/investigations/new?itemId=${report.id}`} className="btn btn-secondary">
                  Create investigation
                </Link>
              ) : null}
            </div>
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
      <ConfirmDialog
        open={askEmail}
        title={emailSent ? 'Send Community Email Again?' : 'Send Community Email?'}
        message={
          selectedCommunityNames.length
            ? `This will email active members of: ${selectedCommunityNames.join(', ')}. Each report can be sent twice.`
            : 'Please select at least one community.'
        }
        confirmLabel="Send Email"
        confirmingLabel="Sending..."
        confirmClassName="btn btn-primary"
        confirming={sendingEmail}
        onCancel={() => {
          if (!sendingEmail) setAskEmail(false);
        }}
        onConfirm={handleSendEmail}
      />
      <SuccessDialog
        message={notice}
        onClose={() => {
          setNotice('');
          navigate('/admin/reports', { replace: true });
        }}
      />
    </AppShell>
  );
}
