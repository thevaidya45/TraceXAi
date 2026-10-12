import api from './api.js';
import { formatReportDate } from './reportService.js';

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

export function getInvestigations(params) {
  return api.get('/admin/investigations', { params });
}

export function getInvestigation(id) {
  return api.get(`/admin/investigations/${id}`);
}

export function createInvestigation(payload) {
  return api.post('/admin/investigations', payload);
}

export function updateInvestigation(id, payload) {
  return api.patch(`/admin/investigations/${id}`, payload);
}

export function closeInvestigation(id) {
  return api.post(`/admin/investigations/${id}/close`);
}

export function addCctvFootage(id, formData) {
  return api.post(`/admin/investigations/${id}/cctv`, formData, asMultipart(formData));
}

export function removeCctvFootage(id, footageId) {
  return api.delete(`/admin/investigations/${id}/cctv/${footageId}`);
}

export function getCctvAnalyses(id) {
  return api.get(`/admin/investigations/${id}/analysis`);
}

export function startCctvAnalysis(id, footageId) {
  return api.post(`/admin/investigations/${id}/cctv/${footageId}/analysis`);
}

export function retryCctvAnalysis(id, footageId) {
  return api.post(`/admin/investigations/${id}/cctv/${footageId}/analysis/retry`);
}

export function getInvestigationReview(id) {
  return api.get(`/admin/investigations/${id}/review`);
}

export function extractEvidenceFrames(id, footageId) {
  return api.post(`/admin/investigations/${id}/cctv/${footageId}/evidence`);
}

const EVIDENCE_STATUSES = {
  AVAILABLE: { label: 'Not extracted', badge: 'badge-neutral' },
  EXTRACTING: { label: 'Extracting', badge: 'badge-warn' },
  COMPLETED: { label: 'Available', badge: 'badge-ok' },
  FAILED: { label: 'Unavailable', badge: 'badge-error' }
};

export function evidenceStatusLabel(status) {
  return (EVIDENCE_STATUSES[status] || EVIDENCE_STATUSES.AVAILABLE).label;
}

export function evidenceStatusBadge(status) {
  return (EVIDENCE_STATUSES[status] || EVIDENCE_STATUSES.AVAILABLE).badge;
}

const ANALYSIS_STATUSES = {
  AVAILABLE: { label: 'Not analysed', badge: 'badge-neutral' },
  PROCESSING: { label: 'Processing', badge: 'badge-warn' },
  COMPLETED: { label: 'Analysis complete', badge: 'badge-ok' },
  FAILED: { label: 'Analysis failed', badge: 'badge-error' }
};

export function analysisStatusLabel(status) {
  return (ANALYSIS_STATUSES[status] || ANALYSIS_STATUSES.AVAILABLE).label;
}

export function analysisStatusBadge(status) {
  return (ANALYSIS_STATUSES[status] || ANALYSIS_STATUSES.AVAILABLE).badge;
}

export const INVESTIGATION_STATUSES = [
  { value: 'CREATED', label: 'Created' },
  { value: 'CCTV_SELECTED', label: 'CCTV selected' },
  { value: 'READY', label: 'Ready' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CLOSED', label: 'Closed' }
];

export const MODULE4_STATUS_OPTIONS = [
  { value: 'CREATED', label: 'Created' },
  { value: 'CCTV_SELECTED', label: 'CCTV selected' },
  { value: 'READY', label: 'Ready' }
];

export function investigationStatusLabel(status) {
  const found = INVESTIGATION_STATUSES.find((item) => item.value === status);
  return found ? found.label : status;
}

export function formatInvestigationDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

export { formatReportDate };
