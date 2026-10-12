import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import AppShell from '../../components/AppShell.jsx';
import BackLink from '../../components/BackLink.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import RecordNotFound from '../../components/RecordNotFound.jsx';
import { ADMIN_NAV } from '../../nav.js';
import { getErrorMessage, isNotFoundError } from '../../services/api.js';
import { deleteAdminCommunity, updateAdminCommunity } from '../../services/adminService.js';
import { getCommunity } from '../../services/communityService.js';
import { formatReportDate } from '../../services/reportService.js';

export default function AdminCommunityDetailsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [community, setCommunity] = useState(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [askDelete, setAskDelete] = useState(false);

  useEffect(() => {
    let active = true;
    setError('');
    setMissing(false);
    getCommunity(id)
      .then((res) => {
        if (!active) return;
        setCommunity(res.data.community);
        setName(res.data.community.name || '');
      })
      .catch((err) => {
        if (!active) return;
        setCommunity(null);
        if (isNotFoundError(err)) {
          setMissing(true);
        } else {
          setError(getErrorMessage(err, 'Unable to load this community.'));
        }
      });
    return () => {
      active = false;
    };
  }, [id]);

  async function handleRename(event) {
    event.preventDefault();
    if (!community) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await updateAdminCommunity(community.id, { name: name.trim() });
      setCommunity(res.data.community);
      setName(res.data.community.name);
      setSuccess('Community updated.');
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to update this community.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!community) return;
    setSaving(true);
    setError('');
    try {
      await deleteAdminCommunity(community.id);
      setAskDelete(false);
      navigate('/admin/communities', { replace: true, state: { notice: 'The community was deleted successfully.' } });
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to delete this community.'));
      setAskDelete(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell items={ADMIN_NAV} active="Communities" title="Community details">
      <p className="lede">
        <BackLink to="/admin/communities">Back to communities</BackLink>
      </p>
      {error && <p className="form-error">{error}</p>}
      {success && <p className="form-success">{success}</p>}
      {!community && !error && !missing ? <p className="muted-text">Loading community...</p> : null}
      {missing ? (
        <RecordNotFound title="Community not found" to="/admin/communities" backLabel="Back to communities" />
      ) : null}

      {community ? (
        <section className="detail-layout">
          <article className="panel">
            <header className="detail-head">
              <div>
                <p className="muted-text" style={{ marginBottom: '0.35rem' }}>Community</p>
                <h2>{community.name}</h2>
              </div>
            </header>
            <dl className="detail-list">
              <div>
                <dt>Name</dt>
                <dd>{community.name}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{formatReportDate(community.createdAt)}</dd>
              </div>
            </dl>
            <div className="form-actions">
              <Link to={`/admin/users?communityId=${community.id}`} className="btn btn-secondary">
                View members
              </Link>
            </div>
          </article>
          <aside className="panel">
            <h2>Edit community</h2>
            <form className="status-form" onSubmit={handleRename}>
              <label className="field">
                <span>Community name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} required maxLength="80" />
              </label>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving...' : 'Save name'}
              </button>
              <button type="button" className="btn btn-danger" disabled={saving} onClick={() => setAskDelete(true)}>
                Delete community
              </button>
            </form>
          </aside>
        </section>
      ) : null}

      <ConfirmDialog
        open={askDelete}
        title="Would you like to delete this community?"
        message={community ? `This will permanently remove “${community.name}”.` : ''}
        confirming={saving}
        onCancel={() => {
          if (!saving) setAskDelete(false);
        }}
        onConfirm={handleDelete}
      />
    </AppShell>
  );
}
