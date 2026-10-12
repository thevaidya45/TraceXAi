import api from './api.js';

function asMultipart(formData) {
  return {
    transformRequest: [
      (data, headers) => {
        if (headers && typeof headers.set === 'function') {
          headers.set('Content-Type', undefined);
        } else if (headers) {
          delete headers['Content-Type'];
        }
        return data;
      }
    ]
  };
}

export function createReport(formData) {
  return api.post('/reports', formData, asMultipart(formData));
}

export function getMyReports(params) {
  return api.get('/reports', { params });
}

export function getMyReport(id) {
  return api.get(`/reports/${id}`);
}

export function updateMyReport(id, formData) {
  return api.patch(`/reports/${id}`, formData, asMultipart(formData));
}

export function updateMyReportStatus(id, status) {
  return api.patch(`/reports/${id}/status`, { status });
}

export function deleteMyReport(id) {
  return api.delete(`/reports/${id}`);
}

export function getAdminReports(params) {
  return api.get('/admin/reports', { params });
}

export function getAdminReport(id) {
  return api.get(`/admin/reports/${id}`);
}

export function updateAdminReportStatus(id, status) {
  return api.patch(`/admin/reports/${id}/status`, { status });
}

export function deleteAdminReport(id) {
  return api.delete(`/admin/reports/${id}`);
}

export function sendCommunityEmailAlert(id, communityIds) {
  return api.post(`/admin/reports/${id}/email-alert`, { communityIds: communityIds || [] });
}

export const REPORT_CATEGORIES = [
  { value: 'electronics', label: 'Electronics' },
  { value: 'clothing', label: 'Clothing' },
  { value: 'documents', label: 'Documents' },
  { value: 'accessories', label: 'Accessories' },
  { value: 'books', label: 'Books' },
  { value: 'keys', label: 'Keys' },
  { value: 'bags', label: 'Bags' },
  { value: 'other', label: 'Other' }
];

export function categoryLabel(value) {
  const found = REPORT_CATEGORIES.find((item) => item.value === value);
  return found ? found.label : value;
}

export function statusLabel(status) {
  const map = {
    active: 'Active',
    recovered: 'Recovered',
    claimed: 'Claimed',
    closed: 'Closed',
    invalid: 'Invalid'
  };
  return map[status] || status;
}

export function typeLabel(type) {
  return type === 'found' ? 'Found' : 'Lost';
}

export function formatReportDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}
