import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../../components/AppShell.jsx';
import ClickableRow, { RowActions } from '../../components/ClickableRow.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import ErrorRetry from '../../components/ErrorRetry.jsx';
import { ADMIN_NAV } from '../../nav.js';
import { getCommunities } from '../../services/communityService.js';
import { getErrorMessage } from '../../services/api.js';
import {
  formatReportDate,
  getInvestigations,
  investigationStatusLabel
} from '../../services/investigationService.js';
import { useListFilters } from '../../hooks/useListFilters.js';

export default function AdminInvestigationsPage() {
  const filters = useListFilters();
  const [rows, setRows] = useState([]);
  const [communities, setCommunities] = useState([]);
  const search = filters.get('search');
  const status = filters.get('status', 'all');
  const communityId = filters.get('communityId');
  const from = filters.get('from');
  const to = filters.get('to');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

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
      if (status !== 'all') query.status = status;
      if (communityId) query.communityId = communityId;
      if (from) query.from = from;
      if (to) query.to = to;
      setLoading(true);
      setError('');
      getInvestigations(query)
        .then((res) => setRows(res.data.investigations || []))
        .catch((err) => setError(getErrorMessage(err, 'Unable to load investigations.')))
        .finally(() => setLoading(false));
    }, search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [search, status, communityId, from, to, reloadKey]);

  return (
    <AppShell items={ADMIN_NAV} active="Investigations" title="Investigations">
      <div className="filter-bar filter-bar-5">
        <label className="field">
          <span>Search</span>
          <input
            type="search"
            value={search}
            onChange={(e) => filters.set('search', e.target.value)}
            placeholder="Case ID or item"
          />
        </label>
        <label className="field">
          <span>Status</span>
          <select value={status || 'all'} onChange={(e) => filters.set('status', e.target.value)}>
            <option value="all">All</option>
            <option value="CREATED">Created</option>
            <option value="CCTV_SELECTED">CCTV selected</option>
            <option value="READY">Ready</option>
            <option value="PROCESSING">Processing</option>
            <option value="COMPLETED">Completed</option>
            <option value="CLOSED">Closed</option>
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
        <label className="field">
          <span>From</span>
          <input type="date" value={from} onChange={(e) => filters.set('from', e.target.value)} />
        </label>
        <label className="field">
          <span>To</span>
          <input type="date" value={to} onChange={(e) => filters.set('to', e.target.value)} />
        </label>
      </div>

      <ErrorRetry message={error} onRetry={() => setReloadKey((value) => value + 1)} />

      {loading ? (
        <div className="skeleton-stack" aria-hidden="true">
          <div className="skeleton-row" />
          <div className="skeleton-row" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No investigations created"
          body="Open an active lost or found report and choose Create Investigation. Automated analysis is not available yet."
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Case</th>
                <th>Item</th>
                <th>Community</th>
                <th>Status</th>
                <th>CCTV</th>
                <th>Created</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <ClickableRow key={row.id} to={`/admin/investigations/${row.id}`} label={`Open investigation ${row.caseId}`}>
                  <td>{row.caseId}</td>
                  <td>{row.item && row.item.itemName ? row.item.itemName : '—'}</td>
                  <td>{row.community && row.community.name ? row.community.name : '—'}</td>
                  <td>
                    <span className={`badge ${row.status === 'CLOSED' ? 'badge-warn' : 'badge-ok'}`}>
                      {investigationStatusLabel(row.status)}
                    </span>
                  </td>
                  <td>{row.cctvCount || 0}</td>
                  <td>{formatReportDate(row.createdAt)}</td>
                  <td>{formatReportDate(row.updatedAt)}</td>
                  <RowActions>
                    <Link to={`/admin/investigations/${row.id}`} className="btn btn-secondary btn-small">
                      Open
                    </Link>
                  </RowActions>
                </ClickableRow>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
