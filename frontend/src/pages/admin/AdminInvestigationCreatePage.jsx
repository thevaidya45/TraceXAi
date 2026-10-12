import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AppShell from '../../components/AppShell.jsx';
import { ADMIN_NAV } from '../../nav.js';
import { getErrorMessage } from '../../services/api.js';
import { formatReportDate, getAdminReport, statusLabel, typeLabel } from '../../services/reportService.js';
import { createInvestigation } from '../../services/investigationService.js';

export default function AdminInvestigationCreatePage() {
  const [params] = useSearchParams();
  const itemId = params.get('itemId') || '';
  const navigate = useNavigate();
  const [report, setReport] = useState(null);
  const [openCase, setOpenCase] = useState(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    if (!itemId) {
      setError('Select a lost or found report to investigate.');
      return undefined;
    }
    getAdminReport(itemId)
      .then((res) => {
        if (!active) return;
        setReport(res.data.report);
        setOpenCase(res.data.investigation || null);
        if (res.data.investigation && res.data.investigation.id) {
          navigate(`/admin/investigations/${res.data.investigation.id}`, { replace: true });
        }
      })
      .catch((err) => {
        if (active) setError(getErrorMessage(err, 'Unable to load this report.'));
      });
    return () => {
      active = false;
    };
  }, [itemId, navigate]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!report) return;
    setSaving(true);
    setError('');
    try {
      const res = await createInvestigation({ itemId: report.id, notes });
      navigate(`/admin/investigations/${res.data.investigation.id}`, { replace: true });
    } catch (err) {
      if (err && err.response && err.response.status === 409 && err.response.data && err.response.data.investigation) {
        navigate(`/admin/investigations/${err.response.data.investigation.id}`, { replace: true });
        return;
      }
      setError(getErrorMessage(err, 'Unable to create this investigation.'));
    } finally {
      setSaving(false);
    }
  }

  const eligible = report && report.status === 'active';

  return (
    <AppShell items={ADMIN_NAV} active="Investigations" title="Create investigation">
      <p className="lede">
        <Link to="/admin/reports">Back to reports</Link>
        {' · '}
        <Link to="/admin/investigations">All investigations</Link>
      </p>
      {error && <p className="form-error">{error}</p>}
      {!report && !error ? <p className="muted-text">Loading report...</p> : null}

      {report ? (
        <section className="detail-layout">
          <article className="panel">
            <header className="detail-head">
              <div>
                <p className="muted-text" style={{ marginBottom: '0.35rem' }}>
                  {typeLabel(report.reportType)} · {statusLabel(report.status)}
                </p>
                <h2>{report.itemName}</h2>
              </div>
            </header>
            <dl className="detail-list">
              <div>
                <dt>Community</dt>
                <dd>{report.community && report.community.name ? report.community.name : '—'}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{report.location}</dd>
              </div>
              <div>
                <dt>Submitted</dt>
                <dd>{formatReportDate(report.createdAt)}</dd>
              </div>
            </dl>
            {openCase ? (
              <p className="muted-text">An open case already exists for this report.</p>
            ) : !eligible ? (
              <p className="form-error">Only active lost or found reports can be investigated.</p>
            ) : (
              <form onSubmit={handleSubmit}>
                <label className="field">
                  <span>Notes</span>
                  <textarea
                    rows="4"
                    maxLength="2000"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Optional case notes. Do not name suspects."
                  />
                </label>
                <div className="form-actions">
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? 'Creating...' : 'Create investigation'}
                  </button>
                </div>
              </form>
            )}
          </article>
        </section>
      ) : null}
    </AppShell>
  );
}
