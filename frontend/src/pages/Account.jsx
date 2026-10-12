import { useState } from 'react';
import AppShell from '../components/AppShell.jsx';
import PasswordField from '../components/PasswordField.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { ADMIN_NAV, EMPLOYEE_NAV, STUDENT_NAV } from '../nav.js';

function navFor(role) {
  if (role === 'admin') return ADMIN_NAV;
  if (role === 'employee') return EMPLOYEE_NAV;
  return STUDENT_NAV;
}

export default function Account() {
  const { user, changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const communityName = user && user.community && user.community.name ? user.community.name : '—';
  const roleLabel = user ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : '';
  const verified = user && user.emailVerified !== false;
  const investigationAccess = user && user.role === 'admin' ? 'Yes' : 'No';

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      const message = await changePassword({ currentPassword, newPassword });
      setSuccess(message);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err.message || 'Unable to update password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell items={navFor(user && user.role)} active="Profile" title="Profile">
      <section className="section-block" style={{ marginBottom: '1rem' }}>
        <header className="section-head">
          <h2>Account</h2>
        </header>
        <div className="panel-pad">
          <dl className="detail-list">
            <div>
              <dt>Name</dt>
              <dd>{user && user.name}</dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>{user && user.email}</dd>
            </div>
            <div>
              <dt>Email verified</dt>
              <dd>
                <span className={`badge ${verified ? 'badge-ok' : 'badge-warn'}`}>
                  {verified ? 'Verified' : 'Not verified'}
                </span>
              </dd>
            </div>
            <div>
              <dt>Account status</dt>
              <dd>
                <span className={`badge ${user && user.status === 'inactive' ? 'badge-warn' : 'badge-ok'}`}>
                  {user && user.status === 'inactive' ? 'Inactive' : 'Active'}
                </span>
              </dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{roleLabel}</dd>
            </div>
            <div>
              <dt>Community</dt>
              <dd>{communityName}</dd>
            </div>
            <div>
              <dt>Investigation access</dt>
              <dd>{investigationAccess}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="section-block">
        <header className="section-head">
          <h2>Change password</h2>
        </header>
        <form className="auth-form panel-pad" onSubmit={handleSubmit} noValidate>
          <PasswordField
            label="Current password"
            name="currentPassword"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
          <PasswordField
            label="New password"
            name="newPassword"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
          <PasswordField
            label="Confirm new password"
            name="confirmPassword"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
          {error && <p className="form-error">{error}</p>}
          {success && <p className="form-success">{success}</p>}
          <button type="submit" className="btn btn-primary" disabled={submitting} style={{ width: 'auto' }}>
            {submitting ? 'Please wait...' : 'Update password'}
          </button>
        </form>
      </section>
    </AppShell>
  );
}
