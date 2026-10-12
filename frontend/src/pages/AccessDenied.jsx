import { Link } from 'react-router-dom';
import AuthSplit from '../components/AuthSplit.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function AccessDenied() {
  const { user, dashboardPath } = useAuth();
  const home = user ? dashboardPath(user.role) : '/';

  return (
    <AuthSplit
      kicker="Access"
      title="Access denied"
      lead="You do not have permission to view this page."
    >
      <Link className="btn btn-primary" to={home}>
        Go back
      </Link>
    </AuthSplit>
  );
}
