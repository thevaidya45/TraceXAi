import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import AuthSplit from '../components/AuthSplit.jsx';
import OtpForm from '../components/OtpForm.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function ForgotPassword() {
  const { user, loading, dashboardPath, forgotPassword, verifyResetOtp } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [step, setStep] = useState('email');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return <div className="page-loading">Loading...</div>;
  }

  if (user) {
    return <Navigate to={dashboardPath(user.role)} replace />;
  }

  async function handleSendOtp(event) {
    event.preventDefault();
    setError('');
    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    setSubmitting(true);
    try {
      const message = await forgotPassword(email.trim());
      setNotice(message || 'OTP sent successfully.');
      setStep('otp');
    } catch (err) {
      setError(err.message || 'Unable to send OTP. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(otp) {
    setError('');
    if (!/^\d{6}$/.test(otp)) {
      setError('Please enter the 6-digit OTP.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await verifyResetOtp({ email: email.trim(), otp });
      if (!result.resetToken) {
        setError('Unable to reset password. Please try again.');
        return;
      }
      navigate('/reset-password', {
        replace: true,
        state: { email: email.trim(), resetToken: result.resetToken }
      });
    } catch (err) {
      setError(err.message || 'Invalid or expired OTP.');
      setNotice('');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setError('');
    setSubmitting(true);
    try {
      const message = await forgotPassword(email.trim());
      setNotice(message || 'OTP sent successfully.');
    } catch (err) {
      setError(err.message || 'Unable to send OTP. Please try again.');
      setNotice('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthSplit
      kicker="Password help"
      title={step === 'email' ? 'Forgot password' : 'Check your email'}
      lead={step === 'email' ? 'Enter the email on your TraceX account.' : undefined}
    >
      {step === 'email' ? (
        <form className="auth-form" onSubmit={handleSendOtp} noValidate>
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
            {error && <p className="form-error">{error}</p>}
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Please wait...' : 'Send OTP'}
            </button>
            <p className="auth-footer">
              <Link to="/login">Back to sign in</Link>
            </p>
          </form>
      ) : (
          <OtpForm
            email={email}
            notice={notice}
            error={error}
            submitting={submitting}
            onVerify={handleVerify}
            onResend={handleResend}
          />
      )}
    </AuthSplit>
  );
}
