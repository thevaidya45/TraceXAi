import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AppShell from '../../components/AppShell.jsx';
import SuccessDialog from '../../components/SuccessDialog.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import ClickableRow, { RowActions } from '../../components/ClickableRow.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import ErrorRetry from '../../components/ErrorRetry.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { EMPLOYEE_NAV, STUDENT_NAV } from '../../nav.js';
import { reportsBasePath } from '../../reportsPaths.js';
import { useListFilters } from '../../hooks/useListFilters.js';
import { getErrorMessage } from '../../services/api.js';
import {
  categoryLabel,
  deleteMyReport,
  formatReportDate,
  getMyReports,
  statusLabel,
  typeLabel
} from '../../services/reportService.js';

export default function MyReportsPage() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const basePath = reportsBasePath(user && user.role);
  const nav = user && user.role === 'employee' ? EMPLOYEE_NAV : STUDENT_NAV;
  const [reports, setReports] = useState([]);
  const filters = useListFilters();
  const type = filters.get('type', 'all');
  const status = filters.get('status', 'all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (location.state && location.state.notice) {
      setNotice(location.state.notice);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location, navigate]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const params = {};
    if (type !== 'all') params.type = type;
    if (status !== 'all') params.status = status;
    getMyReports(params)
      .then((res) => {
        if (active) setReports(res.data.reports || []);
      })
      .catch((err) => {
        if (active) setError(getErrorMessage(err, 'Unable to load your reports.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [type, status, reloadKey]);

  async function confirmDelete() {
    if (!pending) return;
    setError('');
    setDeleting(true);
    try {
      await deleteMyReport(pending.id);
      setReports((current) => current.filter((row) => row.id !== pending.id));
      setPending(null);
      setNotice('The report was deleted successfully.');
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to delete this report.'));
      setPending(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AppShell items={nav} active="My Reports" title="My Reports">
      <p className="lede">Reports you have submitted. You cannot see reports filed by other people.</p>

      <div className="filter-bar filter-bar-2">
        <label className="field">
          <span>Type</span>
          <select value={type || 'all'} onChange={(e) => filters.set('type', e.target.value)}>
            <option value="all">All</option>
            <option value="lost">Lost</option>
            <option value="found">Found</option>
          </select>
        </label>
        <label className="field">
          <span>Status</span>
          <select value={status || 'all'} onChange={(e) => filters.set('status', e.target.value)}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="recovered">Recovered</option>
            <option value="claimed">Claimed</option>
            <option value="closed">Closed</option>
            <option value="invalid">Invalid</option>
          </select>
        </label>
      </div>

      <div className="toolbar-row">
        <Link to={`${basePath}/lost-found`} className="btn btn-secondary btn-small">
          Lost &amp; Found
        </Link>
        <Link to={`${basePath}/reports/new/lost`} className="btn btn-primary btn-small">
          Report lost item
        </Link>
        <Link to={`${basePath}/reports/new/found`} className="btn btn-primary btn-small">
          Report found item
        </Link>
      </div>

      <ErrorRetry message={error} onRetry={() => setReloadKey((value) => value + 1)} />

      {loading ? (
        <div className="skeleton-stack" aria-hidden="true">
          <div className="skeleton-row" />
          <div className="skeleton-row" />
        </div>
      ) : reports.length === 0 ? (
        <EmptyState
          title="No lost or found reports"
          body="Submit a report to track an item in your community."
          action={
            <Link to={`${basePath}/reports/new/lost`} className="btn btn-primary btn-small">
              Report lost item
            </Link>
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Type</th>
                <th>Category</th>
                <th>Status</th>
                <th>Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <ClickableRow key={report.id} to={`${basePath}/reports/${report.id}`} label={`Open details for ${report.itemName}`}>
                  <td>{report.itemName}</td>
                  <td>{typeLabel(report.reportType)}</td>
                  <td>{categoryLabel(report.category)}</td>
                  <td>
                    <span className={`badge ${report.status === 'active' ? 'badge-ok' : 'badge-warn'}`}>
                      {statusLabel(report.status)}
                    </span>
                  </td>
                  <td>{formatReportDate(report.createdAt)}</td>
                  <RowActions>
                    <div className="row-actions">
                      <Link to={`${basePath}/reports/${report.id}`} className="btn btn-secondary btn-small">
                        Open
                      </Link>
                      <button
                        type="button"
                        className="btn btn-danger btn-small"
                        onClick={() => setPending(report)}
                      >
                        Delete
                      </button>
                    </div>
                  </RowActions>
                </ClickableRow>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(pending)}
        title="Would you like to delete this report?"
        message={pending ? `This will permanently remove “${pending.itemName}”.` : ''}
        confirming={deleting}
        onCancel={() => {
          if (!deleting) setPending(null);
        }}
        onConfirm={confirmDelete}
      />
      <SuccessDialog message={notice} onClose={() => setNotice('')} />
    </AppShell>
  );
}
