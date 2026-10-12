import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AppShell from '../../components/AppShell.jsx';
import ClickableRow, { RowActions } from '../../components/ClickableRow.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import SuccessDialog from '../../components/SuccessDialog.jsx';
import {
  createAdminCommunity,
  deleteAdminCommunity,
  getAdminCommunities,
  updateAdminCommunity
} from '../../services/adminService.js';
import { getErrorMessage } from '../../services/api.js';
import { ADMIN_NAV } from '../../nav.js';

export default function CommunityManagement() {
  const location = useLocation();
  const navigate = useNavigate();
  const [communities, setCommunities] = useState([]);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pending, setPending] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState('');

  function load() {
    setLoading(true);
    getAdminCommunities()
      .then((res) => setCommunities(res.data.communities || []))
      .catch((err) => setError(getErrorMessage(err, 'Unable to load communities. Please try again.')))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (location.state && location.state.notice) {
      setNotice(location.state.notice);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location, navigate]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      if (editingId) {
        await updateAdminCommunity(editingId, { name: name.trim() });
        setSuccess('Community updated successfully.');
      } else {
        await createAdminCommunity({ name: name.trim() });
        setSuccess('Community created successfully.');
      }
      setName('');
      setEditingId('');
      load();
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to save this community. Please try again.'));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!pending) return;
    setError('');
    setSuccess('');
    setDeleting(true);
    try {
      await deleteAdminCommunity(pending.id);
      setCommunities((current) => current.filter((row) => row.id !== pending.id));
      if (editingId === pending.id) {
        setEditingId('');
        setName('');
      }
      setPending(null);
      setNotice('The community was deleted successfully.');
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to delete this community.'));
      setPending(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AppShell items={ADMIN_NAV} active="Communities" title="Communities">
      <form className="auth-form" onSubmit={handleSubmit} noValidate style={{ maxWidth: '420px', marginBottom: '1.25rem' }}>
        <label className="field">
          <span>{editingId ? 'Rename community' : 'New community'}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Community name"
            required
          />
        </label>
        {error && <p className="form-error">{error}</p>}
        {success && <p className="form-success">{success}</p>}
        <div className="row-actions">
          <button type="submit" className="btn btn-primary" disabled={saving} style={{ width: 'auto', height: '42px', minHeight: '42px' }}>
            {saving ? 'Please wait...' : editingId ? 'Save changes' : 'Create community'}
          </button>
          {editingId ? (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ width: 'auto', height: '42px', minHeight: '42px' }}
              onClick={() => {
                setEditingId('');
                setName('');
              }}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </form>

      {loading ? (
        <p className="muted-text">Loading communities...</p>
      ) : communities.length === 0 ? (
        <section className="panel">
          <p>No communities yet.</p>
        </section>
      ) : (
        <div className="table-wrap">
          <table className="data-table data-table-split">
            <thead>
              <tr>
                <th>Name</th>
                <th className="row-action-head">Action</th>
              </tr>
            </thead>
            <tbody>
              {communities.map((item) => (
                <ClickableRow key={item.id} to={`/admin/communities/${item.id}`} label={`Open details for ${item.name}`}>
                  <td>{item.name}</td>
                  <RowActions>
                    <div className="row-actions">
                      <Link to={`/admin/communities/${item.id}`} className="btn btn-secondary btn-small">
                        Open
                      </Link>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        onClick={() => {
                          setEditingId(item.id);
                          setName(item.name);
                          setSuccess('');
                          setError('');
                        }}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-small"
                        onClick={() => {
                          setSuccess('');
                          setError('');
                          setPending(item);
                        }}
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
        title="Would you like to delete this community?"
        message={pending ? `This will permanently remove “${pending.name}”.` : ''}
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
