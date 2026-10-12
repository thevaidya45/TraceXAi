export function reportsBasePath(role) {
  if (role === 'employee') return '/employee';
  return '/student';
}

export function navForRole(role) {
  if (role === 'admin') return 'admin';
  if (role === 'employee') return 'employee';
  return 'student';
}
