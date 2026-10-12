import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AppShell from '../../components/AppShell.jsx';
import ClickableRow, { RowActions } from '../../components/ClickableRow.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import ErrorRetry from '../../components/ErrorRetry.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import SuccessDialog from '../../components/SuccessDialog.jsx';
import { ADMIN_NAV } from '../../nav.js';
import { useListFilters } from '../../hooks/useListFilters.js';
import { getCommunities } from '../../services/communityService.js';
import { getErrorMessage } from '../../services/api.js';
import {
  REPORT_CATEGORIES,
  deleteAdminReport,
  formatReportDate,
  getAdminReports,
  statusLabel,
  typeLabel
} from '../../services/reportService.js';

export default function AdminReportsPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const filters = useListFilters();
  const [reports, setReports] = useState([]);
  const [communities, setCommunities] = useState([]);
  const search = filters.get('search');
  const type = filters.get('type', 'all');
  const status = filters.get('status', 'all');
  const category = filters.get('category', 'all');
  const communityId = filters.get('communityId');
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
    getCommunities()
      .then((res) => {
        if (active) setCommunities(res.data.communities || []);
      })
      .catch(() => {
        if (active) setCommunities([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      const query = {};
      if (search.trim()) query.search = search.trim();
      if (type !== 'all') query.type = type;
      if (status !== 'all') query.status = status;
      if (category !== 'all') query.category = category;
      if (communityId) query.communityId = communityId;
      setLoading(true);
      setError('');
      getAdminReports(query)
        .then((res) => {
          setReports(res.data.reports || []);
        })
        .catch((err) => {
          setError(getErrorMessage(err, 'Unable to load reports.'));
        })
        .finally(() => {
          setLoading(false);
        });
    }, search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [search, type, status, category, communityId, reloadKey]);

  async function confirmDelete() {
    if (!pending) return;
    setError('');
    setDeleting(true);
    try {
      await deleteAdminReport(pending.id);
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
    <AppShell items={ADMIN_NAV} active="Lost & Found" title="Lost & Found">
      <div className="filter-bar filter-bar-5">
        <label className="field">
          <span>Search</span>
          <input
            type="search"
            value={search}
            onChange={(e) => filters.set('search', e.target.value)}
            placeholder="Item, description, or location"
          />
        </label>
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
        <label className="field">
          <span>Category</span>
          <select value={category || 'all'} onChange={(e) => filters.set('category', e.target.value)}>
            <option value="all">All</option>
            {REPORT_CATEGORIES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Community</span>
          <select value={communityId} onChange={(e) => filters.set('communityId', e.target.value)}>
            <option value="">All</option>
            {communities.map((community) => (
              <option key={community.id} value={community.id}>
                {community.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <ErrorRetry message={error} onRetry={() => setReloadKey((value) => value + 1)} />

      {loading ? (
        <div className="skeleton-stack" aria-hidden="true">
          <div className="skeleton-row" />
          <div className="skeleton-row" />
        </div>
      ) : reports.length === 0 ? (
        <EmptyState title="No lost or found reports" body="Reports from campus communities will appear here." />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Type</th>
                <th>Status</th>
                <th>Community</th>
                <th>Reporter</th>
                <th>Submitted</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <ClickableRow key={report.id} to={`/admin/reports/${report.id}`} label={`Open details for ${report.itemName}`}>
                  <td>{report.itemName}</td>
                  <td>{typeLabel(report.reportType)}</td>
                  <td>
                    <span className={`badge ${report.status === 'invalid' ? 'badge-warn' : report.status === 'active' ? 'badge-ok' : 'badge-warn'}`}>
                      {statusLabel(report.status)}
                    </span>
                  </td>
                  <td>{report.community && report.community.name ? report.community.name : '—'}</td>
                  <td>{report.reporter && report.reporter.name ? report.reporter.name : '—'}</td>
                  <td>{formatReportDate(report.createdAt)}</td>
                  <RowActions>
                    <div className="row-actions">
                      <Link to={`/admin/reports/${report.id}`} className="btn btn-secondary btn-small">
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
