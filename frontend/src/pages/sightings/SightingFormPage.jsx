import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import AppShell from '../../components/AppShell.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { EMPLOYEE_NAV, STUDENT_NAV } from '../../nav.js';
import { reportsBasePath } from '../../reportsPaths.js';
import { getErrorMessage } from '../../services/api.js';
import { getMyReport } from '../../services/reportService.js';
import { createSighting, updateSighting } from '../../services/sightingService.js';

function toDateInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

export default function SightingFormPage({ existing }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const basePath = reportsBasePath(user && user.role);
  const nav = user && user.role === 'employee' ? EMPLOYEE_NAV : STUDENT_NAV;
  const itemId = existing && existing.item ? existing.item.id : params.get('itemId') || '';

  const [reportName, setReportName] = useState(existing && existing.item ? existing.item.itemName : '');
  const [location, setLocation] = useState(existing ? existing.location : '');
  const [observation, setObservation] = useState(existing ? existing.observation : '');
  const [approximateDate, setApproximateDate] = useState(existing ? toDateInput(existing.approximateDate) : '');
  const [approximateTime, setApproximateTime] = useState(existing ? existing.approximateTime || '' : '');
  const [imageFile, setImageFile] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (existing || !itemId) return;
    let active = true;
    getMyReport(itemId)
      .then((res) => {
        if (active) setReportName(res.data.report.itemName);
      })
      .catch((err) => {
        if (active) setError(getErrorMessage(err, 'Unable to load the related report.'));
      });
    return () => {
      active = false;
    };
  }, [existing, itemId]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    if (!itemId) {
      setError('Open a lost or found report first, then report a sighting.');
      return;
    }
    if (location.trim().length < 2) {
      setError('Please enter a location.');
      return;
    }
    if (observation.trim().length < 10) {
      setError('Please describe what you saw in at least 10 characters.');
      return;
    }
    if (!approximateDate) {
      setError('Please enter an approximate date.');
      return;
    }

    const formData = new FormData();
    if (!existing) formData.append('itemId', itemId);
    formData.append('location', location.trim());
    formData.append('observation', observation.trim());
    formData.append('approximateDate', approximateDate);
    if (approximateTime) formData.append('approximateTime', approximateTime);
    if (imageFile) formData.append('image', imageFile);

    setSubmitting(true);
    try {
      const res = existing
        ? await updateSighting(existing.id, formData)
        : await createSighting(formData);
      navigate(`${basePath}/sightings/${res.data.sighting.id}`, {
        replace: true,
        state: { notice: existing ? 'Sighting updated.' : 'Sighting submitted.' }
      });
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to save this sighting.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppShell items={nav} active="Sightings" title={existing ? 'Edit sighting' : 'Report a sighting'}>
      <p className="lede">
        <Link to={itemId ? `${basePath}/reports/${itemId}` : `${basePath}/sightings`}>Back</Link>
      </p>
      <section className="panel">
        <p className="muted-text">
          Related item: {reportName || '—'}
        </p>
        {error && <p className="form-error">{error}</p>}
        <form className="form-grid" onSubmit={handleSubmit}>
          <label className="field">
            <span>Location</span>
            <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={120} required />
          </label>
          <label className="field">
            <span>Approximate date</span>
            <input type="date" value={approximateDate} onChange={(e) => setApproximateDate(e.target.value)} required />
          </label>
          <label className="field">
            <span>Approximate time (optional)</span>
            <input type="time" value={approximateTime} onChange={(e) => setApproximateTime(e.target.value)} />
          </label>
          <label className="field field-span">
            <span>What did you see?</span>
            <textarea
              rows={5}
              value={observation}
              onChange={(e) => setObservation(e.target.value)}
              maxLength={1000}
              required
            />
          </label>
          <label className="field field-span">
            <span>Photo (optional)</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => setImageFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
            />
          </label>
          <div className="form-actions field-span">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Saving...' : existing ? 'Save changes' : 'Submit sighting'}
            </button>
          </div>
        </form>
      </section>
    </AppShell>
  );
}
