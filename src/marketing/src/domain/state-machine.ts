/**
 * Machine à états du contenu (R1).
 *
 * C'est LA frontière entre génération et diffusion. Une seule règle compte :
 * rien ne peut atteindre `scheduled` sans être passé par `approved`, et
 * `approved` ne s'obtient que par une action humaine.
 *
 * Le claim de publication (phase 2) se fera par bail sur la ligne, pas par un
 * statut intermédiaire, pour que cette liste de statuts reste exactement celle
 * qui a été spécifiée.
 */

import { InvalidTransitionError } from './errors.ts';
import type { Status } from './types.ts';

/** Transitions autorisées. Tout ce qui n'est pas listé est interdit. */
const ALLOWED: Readonly<Record<Status, readonly Status[]>> = {
  // Le validateur bloque ici tant que les citations ne sont pas propres.
  draft: ['pending_review', 'rejected'],
  // Décision humaine (R2).
  pending_review: ['approved', 'rejected', 'draft'],
  // D-10 : annulation possible tant que rien n'est parti.
  approved: ['scheduled', 'rejected', 'pending_review'],
  // Phase 2. Aucun code de la phase 1 ne produit ces transitions.
  scheduled: ['published', 'failed', 'pending_review'],
  published: [],
  failed: ['pending_review', 'rejected'],
  rejected: [],
};

/** Statuts depuis lesquels le contenu peut encore être édité par un humain. */
const EDITABLE: readonly Status[] = ['draft', 'pending_review'];

/** Statuts que le scheduler aura le droit de lire (phase 2). Jamais plus. */
export const PUBLISHABLE_STATUSES: readonly Status[] = ['approved', 'scheduled'];

export function canTransition(from: Status, to: Status): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

/** Lève au lieu de renvoyer false : un appelant qui oublie de tester ne doit pas passer. */
export function assertTransition(from: Status, to: Status): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export function isEditable(status: Status): boolean {
  return EDITABLE.includes(status);
}

export function isTerminal(status: Status): boolean {
  return (ALLOWED[status] ?? []).length === 0;
}

/** Utilisé par les tests d'exhaustivité et par l'UI pour griser les actions. */
export function allowedFrom(status: Status): readonly Status[] {
  return ALLOWED[status] ?? [];
}
