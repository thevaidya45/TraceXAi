import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import AppShell from '../../components/AppShell.jsx';
import BackLink from '../../components/BackLink.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import RecordNotFound from '../../components/RecordNotFound.jsx';
import { ADMIN_NAV } from '../../nav.js';
import { getErrorMessage, isNotFoundError } from '../../services/api.js';
import { deleteAdminUser, getAdminUser, updateAdminUser } from '../../services/adminService.js';
import { getCommunities } from '../../services/communityService.js';
import { formatReportDate } from '../../services/reportService.js';

function roleLabel(role) {
  if (role === 'student') return 'Student';
  if (role === 'employee') return 'Employee';
  if (role === 'admin') return 'Admin';
  return role;
}

export default function AdminUserDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [communities, setCommunities] = useState([]);
  const [role, setRole] = useState('student');
  const [communityId, setCommunityId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [askDelete, setAskDelete] = useState(false);

  function applyUser(next) {
    setUser(next);
    setRole(next.role);
    setCommunityId(next.community && next.community.id ? next.community.id : '');
  }

  useEffect(() => {
    let active = true;
    setError('');
    setMissing(false);
    Promise.all([getAdminUser(id), getCommunities()])
      .then(([userRes, communityRes]) => {
        if (!active) return;
        applyUser(userRes.data.user);
        setCommunities(communityRes.data.communities || []);
      })
      .catch((err) => {
        if (!active) return;
        setUser(null);
        if (isNotFoundError(err)) {
          setMissing(true);
          setError('');
        } else {
          setError(getErrorMessage(err, 'Unable to load this user.'));
        }
      });
    return () => {
      active = false;
    };
  }, [id]);

  const canManage = Boolean(user && user.role !== 'admin');

  async function saveAccount(payload) {
    if (!user || !canManage) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await updateAdminUser(user.id, payload);
      applyUser(res.data.user);
      setSuccess(res.data.message || 'User updated.');
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to update this user.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!user || !canManage) return;
    setSaving(true);
    setError('');
    try {
      await deleteAdminUser(user.id);
      setAskDelete(false);
      navigate('/admin/users', { replace: true, state: { notice: 'User deleted successfully.' } });
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to delete this user.'));
      setAskDelete(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell items={ADMIN_NAV} active="Users" title="User details">
      <p className="lede">
        <BackLink to="/admin/users">Back to users</BackLink>
      </p>
      {error && <p className="form-error">{error}</p>}
      {success && <p className="form-success">{success}</p>}
      {!user && !error && !missing ? <p className="muted-text">Loading user...</p> : null}
      {missing ? <RecordNotFound title="User not found" to="/admin/users" backLabel="Back to users" /> : null}

      {user ? (
        <section className="detail-layout">
          <article className="panel">
            <header className="detail-head">
              <div>
                <p className="muted-text" style={{ marginBottom: '0.35rem' }}>Account</p>
                <h2>{user.name}</h2>
              </div>
              <span className={`badge ${user.status === 'inactive' ? 'badge-warn' : 'badge-ok'}`}>
                {user.status === 'inactive' ? 'Inactive' : 'Active'}
              </span>
            </header>
            <dl className="detail-list">
              <div>
                <dt>Email</dt>
                <dd>{user.email}</dd>
              </div>
              <div>
                <dt>Role</dt>
                <dd>{roleLabel(user.role)}</dd>
              </div>
              <div>
                <dt>Community</dt>
                <dd>
                  {user.community && user.community.id ? (
                    <Link to={`/admin/communities/${user.community.id}`}>
                      {user.community.name || 'Community'}
                    </Link>
                  ) : '—'}
                </dd>
              </div>
              <div>
                <dt>Email verification</dt>
                <dd>{user.emailVerified ? 'Verified' : 'Not verified'}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatReportDate(user.createdAt)}</dd>
              </div>
            </dl>
          </article>

          {canManage ? (
            <aside className="panel">
              <h2>Manage account</h2>
              <form
                className="status-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveAccount({ role, communityId, status: user.status });
                }}
              >
                <label className="field">
                  <span>Role</span>
                  <select value={role} onChange={(e) => setRole(e.target.value)} disabled={saving}>
                    <option value="student">Student</option>
                    <option value="employee">Employee</option>
                  </select>
                </label>
                <label className="field">
                  <span>Community</span>
                  <select value={communityId} onChange={(e) => setCommunityId(e.target.value)} disabled={saving}>
                    {communities.map((community) => (
                      <option key={community.id} value={community.id}>
                        {community.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving...' : 'Save role and community'}
                </button>
              </form>
              <div className="form-actions">
                {user.status === 'active' ? (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={saving}
                    onClick={() => saveAccount({ status: 'inactive' })}
                  >
                    Deactivate
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={saving}
                    onClick={() => saveAccount({ status: 'active' })}
                  >
                    Activate
                  </button>
                )}
                <button type="button" className="btn btn-danger" disabled={saving} onClick={() => setAskDelete(true)}>
                  Delete user
                </button>
              </div>
            </aside>
          ) : (
            <aside className="panel">
              <h2>Admin account</h2>
              <p className="muted-text">Admin accounts cannot be managed from this page.</p>
            </aside>
          )}
        </section>
      ) : null}

      <ConfirmDialog
        open={askDelete}
        title="Would you like to delete this user?"
        message={user ? `This will permanently remove ${user.name}.` : ''}
        confirming={saving}
        onCancel={() => {
          if (!saving) setAskDelete(false);
        }}
        onConfirm={handleDelete}
      />
    </AppShell>
  );
}
