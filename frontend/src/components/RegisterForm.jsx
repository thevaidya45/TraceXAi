import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import PasswordField from './PasswordField.jsx';
import CommunitySelector from './CommunitySelector.jsx';
import { getCommunities } from '../services/communityService.js';
import { getErrorMessage } from '../services/api.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function RegisterForm() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    role: 'student',
    communityId: ''
  });
  const [communities, setCommunities] = useState([]);
  const [loadingCommunities, setLoadingCommunities] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    getCommunities()
      .then((res) => {
        if (active) {
          setCommunities(res.data.communities || []);
        }
      })
      .catch((err) => {
        if (active) {
          setError(getErrorMessage(err, 'Unable to load communities. Please try again.'));
        }
      })
      .finally(() => {
        if (active) {
          setLoadingCommunities(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    if (form.name.trim().length < 2) {
      setError('Please enter your full name.');
      return;
    }
    if (!EMAIL_REGEX.test(form.email.trim())) {
      setError('Please enter a valid email address.');
      return;
    }
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (form.role !== 'student' && form.role !== 'employee') {
      setError('Please select a valid role.');
      return;
    }
    if (!form.communityId) {
      setError('Please select a community.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await register({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.role,
        communityId: form.communityId
      });
      navigate('/verify-email', {
        replace: true,
        state: { email: form.email.trim(), notice: result.message }
      });
    } catch (err) {
      setError(err.message || 'Unable to create your account. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} noValidate>
      <label className="field">
        <span>Name</span>
        <input
          type="text"
          name="name"
          autoComplete="name"
          value={form.name}
          onChange={updateField}
          required
        />
      </label>
      <label className="field">
        <span>Email</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          value={form.email}
          onChange={updateField}
          required
        />
      </label>
      <PasswordField
        label="Password"
        name="password"
        autoComplete="new-password"
        placeholder="Enter your password"
        value={form.password}
        onChange={updateField}
        required
      />
      <PasswordField
        label="Confirm password"
        name="confirmPassword"
        autoComplete="new-password"
        placeholder="Re-enter your password"
        value={form.confirmPassword}
        onChange={updateField}
        required
      />
      <label className="field">
        <span>Role</span>
        <select name="role" value={form.role} onChange={updateField} required>
          <option value="student">Student</option>
          <option value="employee">Employee</option>
        </select>
      </label>
      <CommunitySelector
        communities={communities}
        value={form.communityId}
        onChange={updateField}
        loading={loadingCommunities}
      />
      {error && <p className="form-error">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={submitting}>
        {submitting ? 'Please wait...' : 'Create account'}
      </button>
      <p className="auth-footer">
        Already have an account? <Link to="/login">Login</Link>
      </p>
    </form>
  );
}
