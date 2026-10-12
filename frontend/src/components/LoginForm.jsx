import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import PasswordField from './PasswordField.jsx';

export default function LoginForm() {
  const { login, requestOtp, dashboardPath } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleLogin(event) {
    event.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Please enter your email and password.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await login({ email: email.trim(), password });
      navigate(dashboardPath(result.user.role), { replace: true });
    } catch (err) {
      setError(err.message || 'Unable to sign in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleOtpLogin() {
    setError('');
    if (!email.trim()) {
      setError('Please enter your email to receive an OTP.');
      return;
    }
    setSubmitting(true);
    try {
      const message = await requestOtp(email.trim());
      navigate('/verify-otp', {
        state: { email: email.trim(), notice: message }
      });
    } catch (err) {
      setError(err.message || 'OTP could not be sent. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleLogin} noValidate>
      <label className="field">
        <span>Email</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          placeholder="Enter your email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>
      <PasswordField
        label="Password"
        name="password"
        autoComplete="current-password"
        placeholder="Enter your password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <p className="forgot-link">
        <Link to="/forgot-password">Forgot password?</Link>
      </p>
      {error && <p className="form-error">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={submitting}>
        {submitting ? 'Please wait...' : 'Sign in'}
      </button>
      <div className="divider">
        <span>OR</span>
      </div>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={handleOtpLogin}
        disabled={submitting}
      >
        Continue with Email OTP
      </button>
      <p className="auth-footer">
        Don&apos;t have an account? <Link to="/register">Register</Link>
      </p>
    </form>
  );
}
