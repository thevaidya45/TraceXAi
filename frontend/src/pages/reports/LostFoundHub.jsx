import { Link } from 'react-router-dom';
import AppShell from '../../components/AppShell.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { EMPLOYEE_NAV, STUDENT_NAV } from '../../nav.js';
import { reportsBasePath } from '../../reportsPaths.js';

export default function LostFoundHub() {
  const { user } = useAuth();
  const basePath = reportsBasePath(user && user.role);
  const nav = user && user.role === 'employee' ? EMPLOYEE_NAV : STUDENT_NAV;
  const communityName = user && user.community && user.community.name ? user.community.name : 'your community';

  return (
    <AppShell items={nav} active="Lost & Found" title="Lost & Found">
      <p className="lede">
        Report a lost or found item for {communityName}. Community members receive an in-app alert when a new report is submitted. Email alerts are sent only if an administrator chooses to send them.
      </p>
      <section className="info-grid" aria-label="Report actions">
        <article className="info-card">
          <h2>Lost item</h2>
          <p>Describe something you lost on campus so it can be tracked.</p>
          <Link to={`${basePath}/reports/new/lost`} className="btn btn-primary btn-small" style={{ marginTop: '0.85rem' }}>
            Report lost item
          </Link>
        </article>
        <article className="info-card">
          <h2>Found item</h2>
          <p>Record an item you found so the owner can be identified later.</p>
          <Link to={`${basePath}/reports/new/found`} className="btn btn-primary btn-small" style={{ marginTop: '0.85rem' }}>
            Report found item
          </Link>
        </article>
        <article className="info-card">
          <h2>Sightings</h2>
          <p>If you see a reported item, record where and when you saw it.</p>
          <Link to={`${basePath}/sightings`} className="btn btn-secondary btn-small" style={{ marginTop: '0.85rem' }}>
            View sightings
          </Link>
        </article>
        <article className="info-card">
          <h2>My reports</h2>
          <p>Open your submissions, check status, and mark an item recovered or claimed.</p>
          <Link to={`${basePath}/reports`} className="btn btn-secondary btn-small" style={{ marginTop: '0.85rem' }}>
            View my reports
          </Link>
        </article>
      </section>
    </AppShell>
  );
}
