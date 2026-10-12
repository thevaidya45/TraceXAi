import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AppShell from '../../components/AppShell.jsx';
import ClickableRow, { RowActions } from '../../components/ClickableRow.jsx';
import ManageUserModal from '../../components/ManageUserModal.jsx';
import { deleteAdminUser, getAdminUsers, updateAdminUser } from '../../services/adminService.js';
import { getCommunities } from '../../services/communityService.js';
import { getErrorMessage } from '../../services/api.js';
import { useListFilters } from '../../hooks/useListFilters.js';
import { ADMIN_NAV } from '../../nav.js';

function roleLabel(role) {
  if (role === 'student') return 'Student';
  if (role === 'employee') return 'Employee';
  if (role === 'admin') return 'Admin';
  return role;
}

export default function UserManagement() {
  const location = useLocation();
  const navigate = useNavigate();
  const filters = useListFilters();
  const search = filters.get('search');
  const role = filters.get('role', 'all');
  const communityId = filters.get('communityId');
  const status = filters.get('status', 'all');
  const [users, setUsers] = useState([]);
  const [communities, setCommunities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selected, setSelected] = useState(null);
  const [modalError, setModalError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (location.state && location.state.notice) {
      setSuccess(location.state.notice);
      navigate(location.pathname + location.search, { replace: true, state: {} });
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
      if (role && role !== 'all') query.role = role;
      if (communityId) query.communityId = communityId;
      if (status && status !== 'all') query.status = status;

      setLoading(true);
      setError('');
      getAdminUsers(query)
        .then((res) => {
          setUsers(res.data.users || []);
        })
        .catch((err) => {
          setError(getErrorMessage(err, 'Unable to load users. Please try again.'));
        })
        .finally(() => {
          setLoading(false);
        });
    }, search ? 250 : 0);

    return () => clearTimeout(timer);
  }, [search, role, communityId, status, reloadKey]);

  async function handleSave(payload) {
    if (!selected) return;
    setSaving(true);
    setModalError('');
    try {
      await updateAdminUser(selected.id, payload);
      setSelected(null);
      setSuccess('User updated successfully.');
      setReloadKey((current) => current + 1);
    } catch (err) {
      setModalError(getErrorMessage(err, 'Unable to update this user. Please try again.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!selected) return;
    const confirmed = window.confirm(`Delete ${selected.name}? This cannot be undone.`);
    if (!confirmed) return;

    setSaving(true);
    setModalError('');
    try {
      await deleteAdminUser(selected.id);
      setSelected(null);
      setSuccess('User deleted successfully.');
      setReloadKey((current) => current + 1);
    } catch (err) {
      setModalError(getErrorMessage(err, 'Unable to delete this user. Please try again.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell items={ADMIN_NAV} active="Users" title="User Management">
        <div className="filter-bar">
          <label className="field">
            <span>Search</span>
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSuccess('');
                filters.set('search', e.target.value);
              }}
              placeholder="Search users..."
            />
          </label>
          <label className="field">
            <span>Role</span>
            <select
              value={role || 'all'}
              onChange={(e) => {
                setSuccess('');
                filters.set('role', e.target.value);
              }}
            >
              <option value="all">All</option>
              <option value="student">Student</option>
              <option value="employee">Employee</option>
            </select>
          </label>
          <label className="field">
            <span>Community</span>
            <select
              value={communityId}
              onChange={(e) => {
                setSuccess('');
                filters.set('communityId', e.target.value);
              }}
            >
              <option value="">All</option>
              {communities.map((community) => (
                <option key={community.id} value={community.id}>
                  {community.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Status</span>
            <select
              value={status || 'all'}
              onChange={(e) => {
                setSuccess('');
                filters.set('status', e.target.value);
              }}
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </label>
        </div>

        {error && <p className="form-error">{error}</p>}
        {success && <p className="form-success">{success}</p>}

        {loading ? (
          <p className="muted-text">Loading users...</p>
        ) : users.length === 0 ? (
          <section className="panel">
            <p>No users match the current search or filters.</p>
          </section>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Community</th>
                  <th>Status</th>
                  <th className="row-action-head">Action</th>
                </tr>
              </thead>
              <tbody>
                {users.map((item) => (
                  <ClickableRow key={item.id} to={`/admin/users/${item.id}`} label={`Open details for ${item.name}`}>
                    <td>{item.name}</td>
                    <td>{item.email}</td>
                    <td>{roleLabel(item.role)}</td>
                    <td>{item.community && item.community.name ? item.community.name : '—'}</td>
                    <td>
                      <span className={item.status === 'inactive' ? 'badge badge-warn' : 'badge badge-ok'}>
                        {item.status === 'inactive' ? 'Inactive' : 'Active'}
                      </span>
                    </td>
                    <RowActions>
                      {item.role === 'admin' ? (
                        <span className="muted-text">—</span>
                      ) : (
                        <div className="row-actions">
                          <Link to={`/admin/users/${item.id}`} className="btn btn-secondary btn-small">
                            Open
                          </Link>
                          <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            onClick={() => {
                              setModalError('');
                              setSelected(item);
                            }}
                          >
                            Manage
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-small"
                            onClick={async () => {
                              const confirmed = window.confirm(`Delete ${item.name}? This cannot be undone.`);
                              if (!confirmed) return;
                              setError('');
                              setSuccess('');
                              try {
                                await deleteAdminUser(item.id);
                                setUsers((current) => current.filter((row) => row.id !== item.id));
                                setSuccess('User deleted successfully.');
                              } catch (err) {
                                setError(getErrorMessage(err, 'Unable to delete this user. Please try again.'));
                              }
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </RowActions>
                  </ClickableRow>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {selected && (
        <ManageUserModal
          user={selected}
          communities={communities}
          saving={saving}
          error={modalError}
          onClose={() => setSelected(null)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </AppShell>
  );
}
