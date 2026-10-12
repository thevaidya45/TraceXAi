import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AuthSplit from '../components/AuthSplit.jsx';
import OtpForm from '../components/OtpForm.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function VerifyOtp() {
  const location = useLocation();
  const navigate = useNavigate();
  const { requestOtp, verifyOtp, dashboardPath } = useAuth();
  const email = (location.state && location.state.email) || '';
  const [notice, setNotice] = useState((location.state && location.state.notice) || 'OTP sent successfully.');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleVerify(otp) {
    setError('');
    if (!email) {
      setError('Please start again from the login page.');
      return;
    }
    if (!/^\d{6}$/.test(otp)) {
      setError('Please enter the 6-digit OTP.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await verifyOtp({ email, otp });
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
      setError('Please start again from the login page.');
      return;
    }
    setSubmitting(true);
    try {
      const message = await requestOtp(email);
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
      kicker="One-time code"
      title="Enter your code"
      lead="Use the 6-digit OTP sent to your email."
    >
      {!email ? (
        <p className="form-error">
          Please enter your email on the <Link to="/login">sign in</Link> page first.
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
