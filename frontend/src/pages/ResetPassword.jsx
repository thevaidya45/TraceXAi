import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import AuthSplit from '../components/AuthSplit.jsx';
import PasswordField from '../components/PasswordField.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function ResetPassword() {
  const { user, loading, dashboardPath, resetPassword } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const email = (location.state && location.state.email) || '';
  const resetToken = (location.state && location.state.resetToken) || '';
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return <div className="page-loading">Loading...</div>;
  }

  if (user) {
    return <Navigate to={dashboardPath(user.role)} replace />;
  }

  if (!email || !resetToken) {
    return (
      <AuthSplit
        kicker="Password help"
        title="Reset password"
      >
        <p className="form-error">Please verify your email first.</p>
        <Link className="btn btn-primary" to="/forgot-password">
          Forgot password
        </Link>
      </AuthSplit>
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword.length < 8) {
      setError('Password does not meet the required requirements.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const message = await resetPassword({
        email,
        resetToken,
        newPassword
      });
      setSuccess(message || 'Password reset successfully. Please log in.');
      setTimeout(() => {
        navigate('/login', { replace: true });
      }, 1200);
    } catch (err) {
      setError(err.message || 'Unable to reset password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthSplit
      kicker="Password help"
      title="Choose a new password"
      lead="Use at least 8 characters. Both fields must match."
    >
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <PasswordField
          label="New password"
          name="newPassword"
          autoComplete="new-password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
        />
        <PasswordField
          label="Confirm password"
          name="confirmPassword"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
        />
        {error && <p className="form-error">{error}</p>}
        {success && <p className="form-success">{success}</p>}
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Please wait...' : 'Reset password'}
        </button>
        <p className="auth-footer">
          <Link to="/login">Back to sign in</Link>
        </p>
      </form>
    </AuthSplit>
  );
}
