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

export function createSighting(formData) {
  return api.post('/sightings', formData, asMultipart(formData));
}

export function getSightings(params) {
  return api.get('/sightings', { params });
}

export function getMySightings() {
  return api.get('/sightings', { params: { mine: true } });
}

export function getSighting(id) {
  return api.get(`/sightings/${id}`);
}

export function updateSighting(id, formData) {
  return api.patch(`/sightings/${id}`, formData, asMultipart(formData));
}

export function getAdminSightings(params) {
  return api.get('/admin/sightings', { params });
}

export function getAdminSighting(id) {
  return api.get(`/admin/sightings/${id}`);
}

export function updateAdminSightingStatus(id, status) {
  return api.patch(`/admin/sightings/${id}/status`, { status });
}
