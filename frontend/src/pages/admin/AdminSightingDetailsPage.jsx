import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import AppShell from '../../components/AppShell.jsx';
import BackLink from '../../components/BackLink.jsx';
import RecordNotFound from '../../components/RecordNotFound.jsx';
import { ADMIN_NAV } from '../../nav.js';
import { getErrorMessage, isNotFoundError } from '../../services/api.js';
import { formatReportDate } from '../../services/reportService.js';
import { getAdminSighting, updateAdminSightingStatus } from '../../services/sightingService.js';

export default function AdminSightingDetailsPage() {
  const { id } = useParams();
  const [sighting, setSighting] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let active = true;
    getAdminSighting(id)
      .then((res) => {
        if (active) setSighting(res.data.sighting);
      })
      .catch((err) => {
        if (active) {
          if (isNotFoundError(err)) setMissing(true);
          else setError(getErrorMessage(err, 'Unable to load this sighting.'));
        }
      });
    return () => {
      active = false;
    };
  }, [id]);

  async function setStatus(status) {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const res = await updateAdminSightingStatus(id, status);
      setSighting(res.data.sighting);
      setSuccess('Sighting status updated.');
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to update this sighting.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell items={ADMIN_NAV} active="Sightings" title="Sighting details">
      <p className="lede">
        <BackLink to="/admin/sightings">Back to sightings</BackLink>
      </p>
      {error && <p className="form-error">{error}</p>}
      {success && <p className="form-success">{success}</p>}
      {!sighting && !error && !missing ? <p className="muted-text">Loading sighting...</p> : null}
      {missing ? <RecordNotFound title="Sighting not found" to="/admin/sightings" backLabel="Back to sightings" /> : null}
      {sighting ? (
        <section className="detail-layout">
          <article className="panel">
            <header className="detail-head">
              <h2>
                {sighting.item && sighting.item.id ? (
                  <Link to={`/admin/reports/${sighting.item.id}`}>
                    {sighting.item.itemName || 'Related item'}
                  </Link>
                ) : (
                  'Sighting'
                )}
              </h2>
              <span className={`badge ${sighting.status === 'active' ? 'badge-ok' : 'badge-warn'}`}>
                {sighting.status}
              </span>
            </header>
            <dl className="detail-list">
              <div>
                <dt>Related item</dt>
                <dd>
                  {sighting.item && sighting.item.id ? (
                    <Link to={`/admin/reports/${sighting.item.id}`}>
                      {sighting.item.itemName || 'Open report'}
                    </Link>
                  ) : '—'}
                </dd>
              </div>
              <div>
                <dt>Observation</dt>
                <dd>{sighting.observation}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{sighting.location}</dd>
              </div>
              <div>
                <dt>Community</dt>
                <dd>
                  {sighting.community && sighting.community.id ? (
                    <Link to={`/admin/communities/${sighting.community.id}`}>
                      {sighting.community.name || 'Community'}
                    </Link>
                  ) : (sighting.community && sighting.community.name ? sighting.community.name : '—')}
                </dd>
              </div>
              <div>
                <dt>Reporter</dt>
                <dd>
                  {sighting.reporter && sighting.reporter.id ? (
                    <Link to={`/admin/users/${sighting.reporter.id}`}>
                      {sighting.reporter.name || 'Reporter'}
                    </Link>
                  ) : (sighting.reporter && sighting.reporter.name ? sighting.reporter.name : '—')}
                </dd>
              </div>
              <div>
                <dt>When</dt>
                <dd>
                  {formatReportDate(sighting.approximateDate)}
                  {sighting.approximateTime ? ` · ${sighting.approximateTime}` : ''}
                </dd>
              </div>
            </dl>
            <div className="form-actions" style={{ marginTop: '1.25rem' }}>
              {sighting.item && sighting.item.id ? (
                <Link to={`/admin/reports/${sighting.item.id}`} className="btn btn-secondary">
                  Open related report
                </Link>
              ) : null}
              {sighting.status === 'active' ? (
                <button type="button" className="btn btn-danger" disabled={saving} onClick={() => setStatus('invalid')}>
                  Mark invalid
                </button>
              ) : (
                <button type="button" className="btn btn-primary" disabled={saving} onClick={() => setStatus('active')}>
                  Restore active
                </button>
              )}
            </div>
          </article>
          <aside className="panel">
            <h2>Photo</h2>
            {sighting.hasImage && sighting.imageUrl ? (
              <img className="report-photo" src={sighting.imageUrl} alt="Sighting photo" />
            ) : (
              <p className="muted-text">No photo attached.</p>
            )}
          </aside>
        </section>
      ) : null}
    </AppShell>
  );
}
