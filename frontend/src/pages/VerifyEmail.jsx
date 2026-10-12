import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AuthSplit from '../components/AuthSplit.jsx';
import OtpForm from '../components/OtpForm.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function VerifyEmail() {
  const location = useLocation();
  const navigate = useNavigate();
  const { requestVerificationOtp, verifyEmail, dashboardPath } = useAuth();
  const email = (location.state && location.state.email) || '';
  const [notice, setNotice] = useState(
    (location.state && location.state.notice) || 'OTP sent successfully.'
  );
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleVerify(otp) {
    setError('');
    if (!email) {
      setError('Please start again from registration.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await verifyEmail({ email, otp });
      navigate(dashboardPath(result.user.role), { replace: true });
    } catch (err) {
      setError(err.message || 'Invalid or expired OTP.');
      setNotice('');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    setError('');
    if (!email) {
      setError('Please start again from registration.');
      return;
    }
    setSubmitting(true);
    try {
      const message = await requestVerificationOtp(email);
      setNotice(message || 'OTP sent successfully.');
    } catch (err) {
      setError(err.message || 'OTP could not be sent. Please try again.');
      setNotice('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AuthSplit
      kicker="Verify email"
      title="Confirm your email"
      lead="Enter the 6-digit code sent to your email."
    >
      {!email ? (
        <p className="form-error">
          Please register again from the <Link to="/register">create account</Link> page.
        </p>
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
