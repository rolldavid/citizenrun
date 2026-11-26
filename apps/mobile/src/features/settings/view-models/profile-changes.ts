import { validateHandle } from '@citizenrun/shared';
import type { Me } from '@citizenrun/shared';

export type ProfileInput = {
  name: string | null;
  bio: string | null;
  link: string | null;
  handle: string;
};
export type ProfileChanges = {
  body: { name?: string | null; bio?: string | null; link?: string | null } | null;
  handle: string | null;
};

type TextField = 'name' | 'bio' | 'link';
const TEXT_FIELDS: readonly TextField[] = ['name', 'bio', 'link'];

function cleaned(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function changedHandle(me: Me, typed: string): string | null {
  const result = validateHandle(typed);
  if (result.ok) {
    return result.handle === me.handle ? null : result.handle;
  }
  return typed === me.handle ? null : typed;
}

/** What a save of SCR-settings-profile sends: E-ME-02's changed keys, then E-ME-08's handle (L-profile-text). */
export function profileChanges(me: Me, input: ProfileInput): ProfileChanges {
  const body: { name?: string | null; bio?: string | null; link?: string | null } = {};
  let changed = false;
  for (const field of TEXT_FIELDS) {
    const next = cleaned(input[field]);
    if (next !== me[field]) {
      body[field] = next;
      changed = true;
    }
  }
  return { body: changed ? body : null, handle: changedHandle(me, input.handle) };
}
