import api from './api.js';

export function getCommunities() {
  return api.get('/communities');
}

export function getCommunity(id) {
  return api.get(`/communities/${id}`);
}
