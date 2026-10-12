import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../../components/AppShell.jsx';
import ClickableRow, { RowActions } from '../../components/ClickableRow.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import ErrorRetry from '../../components/ErrorRetry.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { EMPLOYEE_NAV, STUDENT_NAV } from '../../nav.js';
import { reportsBasePath } from '../../reportsPaths.js';
import { useListFilters } from '../../hooks/useListFilters.js';
import { getErrorMessage } from '../../services/api.js';
import { formatReportDate } from '../../services/reportService.js';
import { getMySightings, getSightings } from '../../services/sightingService.js';

export default function SightingsPage() {
  const { user } = useAuth();
  const basePath = reportsBasePath(user && user.role);
  const nav = user && user.role === 'employee' ? EMPLOYEE_NAV : STUDENT_NAV;
  const [rows, setRows] = useState([]);
  const filters = useListFilters();
  const mine = filters.get('mine') === '1';
  const itemId = filters.get('itemId');
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const request = mine ? getMySightings() : getSightings(itemId ? { itemId } : undefined);
    request
      .then((res) => {
        if (active) setRows(res.data.sightings || []);
      })
      .catch((err) => {
        if (active) setError(getErrorMessage(err, 'Unable to load sightings.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mine, itemId, reloadKey]);

  return (
    <AppShell items={nav} active="Sightings" title="Sightings">
      <p className="lede">
        Sightings for items in your community. Open a lost or found report to add a new sighting.
      </p>
      <div className="toolbar-row">
        <button type="button" className={mine ? 'btn btn-secondary btn-small' : 'btn btn-primary btn-small'} onClick={() => filters.set('mine', '')}>
          Community sightings
        </button>
        <button type="button" className={mine ? 'btn btn-primary btn-small' : 'btn btn-secondary btn-small'} onClick={() => filters.set('mine', '1')}>
          My sightings
        </button>
      </div>
      <ErrorRetry message={error} onRetry={() => setReloadKey((value) => value + 1)} />
      {loading ? (
        <div className="skeleton-stack" aria-hidden="true">
          <div className="skeleton-row" />
          <div className="skeleton-row" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No sightings reported"
          body="Open a lost or found report to record a sighting if you see the item."
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Location</th>
                <th>Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <ClickableRow
                  key={row.id}
                  to={`${basePath}/sightings/${row.id}`}
                  label={`Open sighting for ${row.item && row.item.itemName ? row.item.itemName : 'item'}`}
                >
                  <td>{row.item && row.item.itemName ? row.item.itemName : '—'}</td>
                  <td>{row.location}</td>
                  <td>{formatReportDate(row.approximateDate)}</td>
                  <RowActions>
                    <Link to={`${basePath}/sightings/${row.id}`} className="btn btn-secondary btn-small">
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
