import { describe, expect, it } from 'vitest';
import {
  allowedFrom,
  assertTransition,
  canTransition,
  isEditable,
  PUBLISHABLE_STATUSES,
} from '../src/domain/state-machine.ts';
import { STATUSES, type Status } from '../src/domain/types.ts';
import { InvalidTransitionError } from '../src/domain/errors.ts';

describe('machine à états', () => {
  it('autorise le chemin nominal draft → pending_review → approved', () => {
    expect(canTransition('draft', 'pending_review')).toBe(true);
    expect(canTransition('pending_review', 'approved')).toBe(true);
  });

  it('interdit toute transition qui saute la validation humaine', () => {
    // La garantie centrale de R1 : rien n'atteint la diffusion sans `approved`.
    for (const from of STATUSES) {
      if (from === 'approved') continue;
      expect(canTransition(from, 'scheduled')).toBe(false);
    }
  });

  it('interdit de publier directement, quel que soit le point de départ', () => {
    for (const from of STATUSES) {
      if (from === 'scheduled') continue;
      expect(canTransition(from, 'published')).toBe(false);
    }
  });

  it('rend rejected et published terminaux', () => {
    expect(allowedFrom('rejected')).toHaveLength(0);
    expect(allowedFrom('published')).toHaveLength(0);
  });

  it('permet d’annuler une approbation tant que rien n’est parti', () => {
    expect(canTransition('approved', 'rejected')).toBe(true);
    expect(canTransition('approved', 'pending_review')).toBe(true);
  });

  it('lève sur une transition interdite plutôt que de renvoyer false', () => {
    expect(() => assertTransition('published', 'draft')).toThrow(InvalidTransitionError);
  });

  it('n’autorise l’édition humaine que sur draft et pending_review', () => {
    const editable = STATUSES.filter((s: Status) => isEditable(s));
    expect(editable).toEqual(['draft', 'pending_review']);
  });

  it('n’expose que approved et scheduled au futur scheduler', () => {
    expect([...PUBLISHABLE_STATUSES]).toEqual(['approved', 'scheduled']);
  });

  it('couvre tous les statuts déclarés', () => {
    // Un statut ajouté au type sans entrée dans la table serait un trou silencieux.
    for (const s of STATUSES) expect(Array.isArray(allowedFrom(s))).toBe(true);
  });
});
