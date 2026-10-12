import api from './api.js';

export function getAdminUsers(params) {
  return api.get('/admin/users', { params });
}

export function getAdminUser(id) {
  return api.get(`/admin/users/${id}`);
}

export function updateAdminUser(id, payload) {
  return api.patch(`/admin/users/${id}`, payload);
}

export function deleteAdminUser(id) {
  return api.delete(`/admin/users/${id}`);
}

export function getAdminCommunities() {
  return api.get('/admin/communities');
}

export function createAdminCommunity(payload) {
  return api.post('/admin/communities', payload);
}

export function updateAdminCommunity(id, payload) {
  return api.patch(`/admin/communities/${id}`, payload);
}

export function deleteAdminCommunity(id) {
  return api.delete(`/admin/communities/${id}`);
}
