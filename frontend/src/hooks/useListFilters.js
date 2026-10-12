import { useSearchParams } from 'react-router-dom';

export function useListFilters() {
  const [params, setParams] = useSearchParams();

  function get(key, fallback = '') {
    return params.get(key) || fallback;
  }

  function set(key, value) {
    const next = new URLSearchParams(params);
    const normalized = value == null ? '' : String(value);
    if (!normalized || normalized === 'all') {
      next.delete(key);
    } else {
      next.set(key, normalized);
    }
    setParams(next, { replace: true });
  }

  return { params, get, set };
}
