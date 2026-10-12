import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../../components/AppShell.jsx';
import ClickableRow, { RowActions } from '../../components/ClickableRow.jsx';
import { ADMIN_NAV } from '../../nav.js';
import { useListFilters } from '../../hooks/useListFilters.js';
import { getCommunities } from '../../services/communityService.js';
import { getErrorMessage } from '../../services/api.js';
import { formatReportDate } from '../../services/reportService.js';
import { getAdminSightings } from '../../services/sightingService.js';

export default function AdminSightingsPage() {
  const filters = useListFilters();
  const [rows, setRows] = useState([]);
  const [communities, setCommunities] = useState([]);
  const search = filters.get('search');
  const status = filters.get('status', 'all');
  const communityId = filters.get('communityId');
  const itemId = filters.get('itemId');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
      if (itemId) query.itemId = itemId;
      setLoading(true);
      setError('');
      getAdminSightings(query)
        .then((res) => setRows(res.data.sightings || []))
        .catch((err) => setError(getErrorMessage(err, 'Unable to load sightings.')))
        .finally(() => setLoading(false));
    }, search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [search, status, communityId, itemId]);

  return (
    <AppShell items={ADMIN_NAV} active="Sightings" title="Sightings">
      <div className="filter-bar filter-bar-2">
        <label className="field">
          <span>Search</span>
          <input value={search} onChange={(e) => filters.set('search', e.target.value)} placeholder="Location or observation" />
        </label>
        <label className="field">
          <span>Status</span>
          <select value={status || 'all'} onChange={(e) => filters.set('status', e.target.value)}>
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="invalid">Invalid</option>
          </select>
        </label>
        <label className="field">
          <span>Community</span>
          <select value={communityId} onChange={(e) => filters.set('communityId', e.target.value)}>
            <option value="">All communities</option>
            {communities.map((community) => (
              <option key={community.id || community._id} value={community.id || community._id}>
                {community.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="form-error">{error}</p>}
      {loading ? (
        <p className="muted-text">Loading sightings...</p>
      ) : rows.length === 0 ? (
        <section className="panel">
          <p>No sightings found.</p>
        </section>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Community</th>
                <th>Location</th>
                <th>Status</th>
                <th>Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <ClickableRow key={row.id} to={`/admin/sightings/${row.id}`} label={`Open sighting at ${row.location}`}>
                  <td>{row.item && row.item.itemName ? row.item.itemName : '—'}</td>
                  <td>{row.community && row.community.name ? row.community.name : '—'}</td>
                  <td>{row.location}</td>
                  <td>
                    <span className={`badge ${row.status === 'active' ? 'badge-ok' : 'badge-warn'}`}>
                      {row.status}
                    </span>
                  </td>
                  <td>{formatReportDate(row.createdAt)}</td>
                  <RowActions>
                    <Link to={`/admin/sightings/${row.id}`} className="btn btn-secondary btn-small">
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
