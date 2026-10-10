// Påminnelser via webbläsarens notiser. Fungerar medan appen är öppen eller ligger
// i bakgrunden; webben saknar pålitliga schemalagda notiser när appen är stängd.

const timers = new Map<string, number[]>();

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export async function ensurePermission(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  const r = await Notification.requestPermission();
  return r === 'granted' ? 'granted' : 'denied';
}

async function show(title: string, body: string) {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, { body, icon: '/icon-192.png', tag: title });
    else new Notification(title, { body, icon: '/icon-192.png' });
  } catch {
    /* notiser ej tillgängliga */
  }
}

export function schedule(group: string, items: { at: number; title: string; body: string }[]): number {
  cancel(group);
  const ids: number[] = [];
  for (const it of items) {
    const ms = it.at - Date.now();
    if (ms < 0 || ms > 6 * 3600_000) continue;
    ids.push(window.setTimeout(() => void show(it.title, it.body), ms));
  }
  timers.set(group, ids);
  return ids.length;
}

export function cancel(group: string) {
  for (const id of timers.get(group) ?? []) clearTimeout(id);
  timers.delete(group);
}

export function isScheduled(group: string): boolean {
  return (timers.get(group)?.length ?? 0) > 0;
}
