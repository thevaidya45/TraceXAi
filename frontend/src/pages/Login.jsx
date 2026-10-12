import { Navigate } from 'react-router-dom';
import AuthSplit from '../components/AuthSplit.jsx';
import LoginForm from '../components/LoginForm.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const { user, loading, dashboardPath } = useAuth();

  if (loading) {
    return <div className="page-loading">Loading...</div>;
  }

  if (user) {
    return <Navigate to={dashboardPath(user.role)} replace />;
  }

  return (
    <AuthSplit title="Welcome back" lead="Sign in to your account.">
      <LoginForm />
    </AuthSplit>
  );
}
