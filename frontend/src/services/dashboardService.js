import api from './api.js';

export function getDashboard(role) {
  return api.get(`/dashboard/${role}`);
}
