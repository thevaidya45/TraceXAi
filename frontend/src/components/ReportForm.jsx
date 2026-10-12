import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  REPORT_CATEGORIES,
  createReport,
  updateMyReport
} from '../services/reportService.js';
import { getErrorMessage } from '../services/api.js';

function toDateInput(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

export default function ReportForm({
  reportType,
  basePath,
  existing,
  communityName
}) {
  const navigate = useNavigate();
  const isEdit = Boolean(existing);
  const [itemName, setItemName] = useState(existing ? existing.itemName : '');
  const [category, setCategory] = useState(existing ? existing.category : '');
  const [description, setDescription] = useState(existing ? existing.description : '');
  const [location, setLocation] = useState(existing ? existing.location : '');
  const [approximateDate, setApproximateDate] = useState(
    existing ? toDateInput(existing.approximateDate) : ''
  );
  const [approximateTime, setApproximateTime] = useState(existing ? existing.approximateTime || '' : '');
  const [imageFile, setImageFile] = useState(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!existing) return;
    setItemName(existing.itemName || '');
    setCategory(existing.category || '');
    setDescription(existing.description || '');
    setLocation(existing.location || '');
    setApproximateDate(toDateInput(existing.approximateDate));
    setApproximateTime(existing.approximateTime || '');
  }, [existing]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');

    if (itemName.trim().length < 2) {
      setError('Please enter an item name.');
      return;
    }
    if (!category) {
      setError('Please select a category.');
      return;
    }
    if (description.trim().length < 10) {
      setError('Please describe the item in at least 10 characters.');
      return;
    }
    if (location.trim().length < 2) {
      setError('Please enter a location.');
      return;
    }
    if (!approximateDate) {
      setError('Please enter an approximate date.');
      return;
    }

    const formData = new FormData();
    if (!isEdit) {
      formData.append('reportType', reportType);
    }
    formData.append('itemName', itemName.trim());
    formData.append('category', category);
    formData.append('description', description.trim());
    formData.append('location', location.trim());
    formData.append('approximateDate', approximateDate);
    formData.append('approximateTime', approximateTime);

    if (imageFile) {
      formData.append('image', imageFile);
    }

    setSubmitting(true);
    try {
      if (isEdit) {
        const res = await updateMyReport(existing.id, formData);
        navigate(`${basePath}/reports/${res.data.report.id}`);
      } else {
        const res = await createReport(formData);
        navigate(`${basePath}/reports/${res.data.report.id}`);
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Unable to save this report. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  }

  const title = isEdit
    ? 'Edit report'
    : reportType === 'found'
      ? 'Report a found item'
      : 'Report a lost item';

  return (
    <form className="report-form" onSubmit={handleSubmit} noValidate>
      <p className="lede">
        {isEdit
          ? 'Update the details while this report is still active.'
          : `This report will be filed for ${communityName || 'your assigned community'}. You cannot choose a different community.`}
      </p>

      {error && <p className="form-error">{error}</p>}

      <div className="form-grid">
        <label className="field">
          <span>Item name</span>
          <input
            name="itemName"
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
            maxLength={80}
            required
          />
        </label>
        <label className="field">
          <span>Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} required>
            <option value="">Select a category</option>
            {REPORT_CATEGORIES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field field-span">
          <span>Description</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            maxLength={1000}
            required
          />
        </label>
        <label className="field">
          <span>Location</span>
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            maxLength={120}
            required
          />
        </label>
        <label className="field">
          <span>Community</span>
          <input value={communityName || 'Assigned community'} disabled readOnly />
        </label>
        <label className="field">
          <span>Approximate date</span>
          <input
            type="date"
            value={approximateDate}
            onChange={(e) => setApproximateDate(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Approximate time (optional)</span>
          <input
            type="time"
            value={approximateTime}
            onChange={(e) => setApproximateTime(e.target.value)}
          />
        </label>
        <label className="field field-span">
          <span>{isEdit ? 'Replace image (optional)' : 'Photo (optional)'}</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            onChange={(e) => setImageFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
          />
          <span className="field-hint">JPEG, PNG, or WebP. Maximum 2 MB.</span>
        </label>
      </div>

      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Saving...' : isEdit ? 'Save changes' : title}
        </button>
        <Link to={`${basePath}/reports`} className="btn btn-secondary">
          Cancel
        </Link>
      </div>
    </form>
  );
}
