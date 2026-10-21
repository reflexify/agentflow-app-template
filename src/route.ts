const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Route = { view: 'inbox' } | { view: 'task'; entityId: string; recordId: string } | { view: 'records' } | { view: 'start' };

export function parseRoute(hash: string): Route {
  const [, view, entityId, recordId] = hash.replace(/^#/, '').split('/');
  if (view === 'task' && entityId && recordId && UUID.test(entityId) && UUID.test(recordId)) return { view: 'task', entityId, recordId };
  if (view === 'records') return { view: 'records' };
  if (view === 'start') return { view: 'start' };
  return { view: 'inbox' };
}

export const go = (hash: string) => {
  location.hash = hash;
};
