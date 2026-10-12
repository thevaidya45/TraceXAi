import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppShell from '../components/AppShell.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { getCommunity } from '../services/communityService.js';
import { getErrorMessage } from '../services/api.js';
import { EMPLOYEE_NAV, STUDENT_NAV } from '../nav.js';

export default function CommunityPage() {
  const { user } = useAuth();
  const [error, setError] = useState('');
  const [community, setCommunity] = useState(null);

  const items = user && user.role === 'employee' ? EMPLOYEE_NAV : STUDENT_NAV;
  const communityId = user && user.community ? user.community.id : null;
  const assignedName = user && user.community ? user.community.name : '';

  useEffect(() => {
    if (!communityId) {
      return;
    }
    let active = true;
    getCommunity(communityId)
      .then((res) => {
        if (active) setCommunity(res.data.community);
      })
      .catch((err) => {
        if (active) setError(getErrorMessage(err, 'Unable to load this community. Please try again.'));
      });
    return () => {
      active = false;
    };
  }, [communityId]);

  return (
    <AppShell items={items} active="Community" title="Community">
      {error && <p className="form-error">{error}</p>}
      <section className="section-block">
        <header className="section-head">
          <h2>Your community</h2>
        </header>
        <div className="empty-line">
          <span>
            {(community && community.name) || assignedName || 'No community assigned'}
            {community && community.createdAt ? ` · created ${new Date(community.createdAt).toLocaleDateString()}` : ''}
          </span>
          <span>Use Lost &amp; Found to submit reports for this community. Sightings appear when members record them.</span>
          <p style={{ marginTop: '0.85rem' }}>
            <Link className="btn btn-primary btn-small" to={user && user.role === 'employee' ? '/employee/lost-found' : '/student/lost-found'}>
              Open Lost &amp; Found
            </Link>
          </p>
        </div>
      </section>
    </AppShell>
  );
}
