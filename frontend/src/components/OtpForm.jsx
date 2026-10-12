import { useMemo, useState } from 'react';

export default function OtpForm({ email, onVerify, onResend, submitting, error, notice }) {
  const [digits, setDigits] = useState(['', '', '', '', '', '']);

  const otp = useMemo(() => digits.join(''), [digits]);

  function applyCode(code, startIndex = 0) {
    const cleaned = String(code || '').replace(/\D/g, '');
    if (!cleaned) {
      return;
    }
    setDigits((current) => {
      const next = [...current];
      cleaned.split('').forEach((char, offset) => {
        const index = startIndex + offset;
        if (index < 6) {
          next[index] = char;
        }
      });
      return next;
    });
  }

  function handleChange(index, value) {
    const cleaned = value.replace(/\D/g, '');
    if (cleaned.length > 1) {
      applyCode(cleaned, 0);
      return;
    }
    setDigits((current) => {
      const next = [...current];
      next[index] = cleaned.slice(-1);
      return next;
    });
    if (cleaned && index < 5) {
      const sibling = document.getElementById(`otp-${index + 1}`);
      if (sibling) sibling.focus();
    }
  }

  function handleKeyDown(index, event) {
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      const sibling = document.getElementById(`otp-${index - 1}`);
      if (sibling) sibling.focus();
    }
  }

  function handlePaste(event) {
    event.preventDefault();
    applyCode(event.clipboardData.getData('text'), 0);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    await onVerify(otp);
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      <p className="muted-text">Enter the OTP sent to your email. Check Spam and Promotions if it is not in your inbox.</p>
      {email && <p className="email-hint">{email}</p>}
      {notice && <p className="form-success">{notice}</p>}
      <div className="otp-row">
        {digits.map((digit, index) => (
          <input
            key={index}
            id={`otp-${index}`}
            className="otp-input"
            inputMode="numeric"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            maxLength={index === 0 ? 6 : 1}
            value={digit}
            onChange={(e) => handleChange(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            onPaste={handlePaste}
            aria-label={`Digit ${index + 1}`}
          />
        ))}
      </div>
      {error && <p className="form-error">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={submitting || otp.length !== 6}>
        {submitting ? 'Please wait...' : 'Verify OTP'}
      </button>
      <button type="button" className="btn btn-secondary" onClick={onResend} disabled={submitting}>
        Resend OTP
      </button>
    </form>
  );
}
