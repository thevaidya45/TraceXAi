import { Navigate } from 'react-router-dom';
import AuthSplit from '../components/AuthSplit.jsx';
import RegisterForm from '../components/RegisterForm.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Register() {
  const { user, loading, dashboardPath } = useAuth();

  if (loading) {
    return <div className="page-loading">Loading...</div>;
  }

  if (user) {
    return <Navigate to={dashboardPath(user.role)} replace />;
  }

  return (
    <AuthSplit kicker="Create account" title="Register">
      <RegisterForm />
    </AuthSplit>
  );
}
