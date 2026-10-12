import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import AppShell from '../../components/AppShell.jsx';
import BackLink from '../../components/BackLink.jsx';
import RecordNotFound from '../../components/RecordNotFound.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { EMPLOYEE_NAV, STUDENT_NAV } from '../../nav.js';
import { reportsBasePath } from '../../reportsPaths.js';
import { getErrorMessage, isNotFoundError } from '../../services/api.js';
import { formatReportDate } from '../../services/reportService.js';
import { getSighting } from '../../services/sightingService.js';
import SightingFormPage from './SightingFormPage.jsx';

export default function SightingDetailsPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const basePath = reportsBasePath(user && user.role);
  const nav = user && user.role === 'employee' ? EMPLOYEE_NAV : STUDENT_NAV;
  const [sighting, setSighting] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState('');
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (location.state && location.state.notice) {
      setNotice(location.state.notice);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location, navigate]);

  useEffect(() => {
    let active = true;
    setEditing(false);
    setError('');
    setMissing(false);
    getSighting(id)
      .then((res) => {
        if (active) setSighting(res.data.sighting);
      })
      .catch((err) => {
        if (active) {
          setSighting(null);
          if (isNotFoundError(err)) {
            setMissing(true);
          } else {
            setError(getErrorMessage(err, 'Unable to load this sighting.'));
          }
        }
      });
    return () => {
      active = false;
    };
  }, [id]);

  const isOwner = Boolean(
    sighting &&
      sighting.reporter &&
      user &&
      sighting.reporter.id === user.id
  );

  if (editing && sighting) {
    return <SightingFormPage existing={sighting} />;
  }

  return (
    <AppShell items={nav} active="Sightings" title="Sighting details">
      <p className="lede">
        <BackLink to={`${basePath}/sightings`}>Back to sightings</BackLink>
      </p>
      {notice && <p className="form-success">{notice}</p>}
      {error && <p className="form-error">{error}</p>}
      {!sighting && !error && !missing ? <p className="muted-text">Loading sighting...</p> : null}
      {missing ? <RecordNotFound title="Sighting not found" to={`${basePath}/sightings`} backLabel="Back to sightings" /> : null}
      {sighting ? (
        <section className="detail-layout">
          <article className="panel">
            <h2>
              {sighting.item && sighting.item.id ? (
                <Link to={`${basePath}/reports/${sighting.item.id}`}>
                  {sighting.item.itemName || 'Related item'}
                </Link>
              ) : (
                'Sighting'
              )}
            </h2>
            <dl className="detail-list">
              <div>
                <dt>Related item</dt>
                <dd>
                  {sighting.item && sighting.item.id ? (
                    <Link to={`${basePath}/reports/${sighting.item.id}`}>
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
                <dt>When</dt>
                <dd>
                  {formatReportDate(sighting.approximateDate)}
                  {sighting.approximateTime ? ` · ${sighting.approximateTime}` : ''}
                </dd>
              </div>
              <div>
                <dt>Reported by</dt>
                <dd>{sighting.reporter && sighting.reporter.name ? sighting.reporter.name : '—'}</dd>
              </div>
            </dl>
            <div className="form-actions" style={{ marginTop: '1.25rem' }}>
              {sighting.item && sighting.item.id ? (
                <Link to={`${basePath}/reports/${sighting.item.id}`} className="btn btn-secondary">
                  Open related report
                </Link>
              ) : null}
              {isOwner && sighting.status === 'active' ? (
                <button type="button" className="btn btn-primary" onClick={() => setEditing(true)}>
                  Edit sighting
                </button>
              ) : null}
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
