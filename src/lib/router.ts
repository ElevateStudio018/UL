import { useEffect, useState } from 'react';

export type Route =
  | { name: 'planera' }
  | { name: 'karta' }
  | { name: 'sparat' }
  | { name: 'installningar' }
  | { name: 'delad'; id: string };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/');
  switch (parts[0]) {
    case 'karta':
      return { name: 'karta' };
    case 'sparat':
      return { name: 'sparat' };
    case 'installningar':
      return { name: 'installningar' };
    case 'delad':
      if (parts[1] && /^[A-Za-z0-9_-]{16,64}$/.test(parts[1])) return { name: 'delad', id: parts[1] };
      return { name: 'planera' };
    default:
      return { name: 'planera' };
  }
}

export function navigate(path: string) {
  location.hash = `#/${path}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
