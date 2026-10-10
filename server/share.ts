// Gemensamma reselänkar. Lagras i minnet, med svårgissade id, tidsbegränsad
// giltighet och en egen nyckel per deltagare. Ingen positionshistorik sparas:
// för frivillig livedelning finns bara den senaste punkten, med utgångstid.

import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { LatLng, MatchStrategy, PairOption, Place, ShareParticipant, ShareState, ShareStatus, TimeQuery } from '../shared/types';

interface StoredShare extends ShareState {
  tokens: [string, string | null];
}

export class ShareError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const MAX_SHARES = 10_000;
const MAX_LIVE_MIN = 120;

export function newSecret(bytes = 18): string {
  return randomBytes(bytes).toString('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export class ShareStore {
  private shares = new Map<string, StoredShare>();

  constructor() {
    setInterval(() => this.sweep(), 60_000).unref();
  }

  sweep(now = Date.now()) {
    for (const [id, s] of this.shares) {
      if (s.expiresAt < now) this.shares.delete(id);
      else for (const p of s.participants) if (p.live && p.live.until < now) delete p.live;
    }
  }

  create(input: { destination: Place; time: TimeQuery; strategy: MatchStrategy; tolerance: number; option?: PairOption; names: [string, string]; origin?: Place; demo: boolean }) {
    if (this.shares.size >= MAX_SHARES) this.sweep();
    if (this.shares.size >= MAX_SHARES) throw new ShareError(503, 'För många aktiva reselänkar just nu. Försök igen senare.');
    const now = Date.now();
    const tripTime = input.time.mode === 'now' ? now : input.time.at;
    const expiresAt = Math.min(now + 48 * 3600_000, Math.max(now + 12 * 3600_000, tripTime + 6 * 3600_000));
    const id = newSecret(16);
    const token = newSecret();
    const participant = (name: string, joined: boolean, origin?: Place): ShareParticipant => ({ name: name.slice(0, 40), joined, confirmed: false, status: 'none', origin });
    const share: StoredShare = {
      id,
      createdAt: now,
      expiresAt,
      destination: input.destination,
      time: input.time,
      strategy: input.strategy,
      tolerance: input.tolerance,
      option: input.option,
      participants: [participant(input.names[0], true, input.origin), participant(input.names[1], false)],
      demo: input.demo,
      tokens: [token, null],
    };
    this.shares.set(id, share);
    return { id, token, participant: 0 as const, expiresAt };
  }

  private getStored(id: string): StoredShare {
    const s = this.shares.get(id);
    if (!s || s.expiresAt < Date.now()) throw new ShareError(404, 'Reselänken finns inte eller har gått ut.');
    return s;
  }

  get(id: string): ShareState {
    const s = this.getStored(id);
    const now = Date.now();
    const { tokens: _tokens, ...pub } = s;
    return {
      ...pub,
      participants: s.participants.map((p) => (p.live && p.live.until < now ? { ...p, live: undefined } : { ...p })) as [ShareParticipant, ShareParticipant],
    };
  }

  /** Vilken deltagare en nyckel hör till, eller null. */
  who(id: string, token: string | undefined): 0 | 1 | null {
    if (!token) return null;
    const s = this.getStored(id);
    if (safeEqual(s.tokens[0], token)) return 0;
    if (s.tokens[1] && safeEqual(s.tokens[1], token)) return 1;
    return null;
  }

  join(id: string, name: string, origin?: Place) {
    const s = this.getStored(id);
    if (s.tokens[1]) throw new ShareError(409, 'Någon har redan gått med i den här resan.');
    const token = newSecret();
    s.tokens[1] = token;
    s.participants[1] = { ...s.participants[1], name: (name || s.participants[1].name).slice(0, 40), joined: true, origin };
    // Ny deltagare → tidigare bekräftelser gäller inte längre.
    s.participants[0].confirmed = false;
    return { token, participant: 1 as const };
  }

  private auth(id: string, token: string | undefined): { s: StoredShare; idx: 0 | 1 } {
    const idx = this.who(id, token);
    if (idx === null) throw new ShareError(403, 'Du har inte behörighet att ändra den här resan.');
    return { s: this.getStored(id), idx };
  }

  update(id: string, token: string | undefined, patch: { confirmed?: boolean; status?: ShareStatus; origin?: Place; name?: string; option?: PairOption | null }) {
    const { s, idx } = this.auth(id, token);
    const me = s.participants[idx];
    if (patch.name !== undefined) me.name = patch.name.slice(0, 40);
    if (patch.origin !== undefined) {
      me.origin = patch.origin;
      s.participants.forEach((p) => (p.confirmed = false));
    }
    if (patch.option !== undefined) {
      s.option = patch.option ?? undefined;
      s.participants.forEach((p, i) => (p.confirmed = i === idx));
    }
    if (patch.confirmed !== undefined) me.confirmed = patch.confirmed;
    if (patch.status !== undefined) {
      me.status = patch.status;
      me.statusAt = Date.now();
    }
    return this.get(id);
  }

  setLive(id: string, token: string | undefined, pos: LatLng, minutes: number) {
    const { s, idx } = this.auth(id, token);
    const mins = Math.max(1, Math.min(MAX_LIVE_MIN, Math.round(minutes)));
    const prev = s.participants[idx].live;
    const until = prev && prev.until > Date.now() && !minutes ? prev.until : Date.now() + mins * 60_000;
    s.participants[idx].live = { lat: pos.lat, lng: pos.lng, at: Date.now(), until };
    return this.get(id);
  }

  stopLive(id: string, token: string | undefined) {
    const { s, idx } = this.auth(id, token);
    delete s.participants[idx].live;
    return this.get(id);
  }

  remove(id: string, token: string | undefined) {
    const { idx } = this.auth(id, token);
    if (idx !== 0) throw new ShareError(403, 'Bara den som skapade resan kan avsluta delningen.');
    this.shares.delete(id);
  }
}
