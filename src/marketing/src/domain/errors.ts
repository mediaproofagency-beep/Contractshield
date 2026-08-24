/**
 * Erreurs typées. Aucun `catch` générique n'est autorisé dans ce module :
 * la revue a relevé que le rattrapage attrape-tout masque exactement les pannes
 * qu'on veut voir (carte des erreurs, phase CEO section 2).
 */

export class MarketingError extends Error {
  /** Ce que le fondateur doit faire. Vide seulement si rien n'est actionnable. */
  readonly remediation: string;

  constructor(message: string, remediation = '') {
    super(message);
    this.name = new.target.name;
    this.remediation = remediation;
  }
}

/** Le modèle a renvoyé un corps vide. */
export class EmptyGenerationError extends MarketingError {
  constructor() {
    super(
      'Le modèle a renvoyé un corps vide.',
      'Relance la génération. Si cela se répète sur le même angle, retire-le ou reformule son payload.',
    );
  }
}

/** Le modèle a refusé de répondre. */
export class GenerationRefusedError extends MarketingError {
  readonly detail: string;

  constructor(detail: string) {
    super(
      `Le modèle a refusé de générer : ${detail}`,
      "Vérifie le payload de l'angle. Un refus répété signale un angle sensible à retirer.",
    );
    this.detail = detail;
  }
}

/** Réponse illisible (JSON malformé, format inattendu). */
export class GenerationParseError extends MarketingError {
  readonly detail: string;

  constructor(detail: string) {
    super(
      `Réponse du modèle illisible : ${detail}`,
      'Relance la génération. Si le format change durablement, la version de prompt doit être mise à jour.',
    );
    this.detail = detail;
  }
}

/** Appel Mistral en échec réseau ou HTTP. */
export class GenerationUnavailableError extends MarketingError {
  readonly detail: string;

  constructor(detail: string) {
    super(
      `Mistral injoignable : ${detail}`,
      "Réessaie plus tard. La file de validation reste utilisable, seule la génération est bloquée.",
    );
    this.detail = detail;
  }
}

/** Aucun angle actif disponible. Le générateur n'invente jamais un angle (D-11). */
export class NoActiveAngleError extends MarketingError {
  constructor() {
    super(
      'Aucun angle actif disponible.',
      "Ajoute des angles (`marketing angles:seed`) avant de générer. Le générateur n'invente pas de sujet.",
    );
  }
}

/** Transition de statut interdite par la machine à états. */
export class InvalidTransitionError extends MarketingError {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    super(
      `Transition interdite : ${from} → ${to}.`,
      "Recharge la file : l'item a probablement changé d'état dans un autre onglet.",
    );
    this.from = from;
    this.to = to;
  }
}

/** L'update conditionnel n'a touché aucune ligne (double-clic, onglet concurrent). */
export class StaleItemError extends MarketingError {
  readonly id: number;

  constructor(id: number) {
    super(
      `L'item ${id} a changé d'état entre l'affichage et l'action.`,
      'Recharge la file. Aucune action n\'a été appliquée.',
    );
    this.id = id;
  }
}

/** Approbation refusée : le validateur de citations n'est pas au vert. */
export class UnvalidatedContentError extends MarketingError {
  readonly id: number;
  readonly count: number;

  constructor(id: number, count: number) {
    super(
      `L'item ${id} porte ${count} erreur(s) de validation et ne peut pas être approuvé.`,
      'Édite le corps pour corriger les citations, ou rejette-le avec le motif « citation fausse ».',
    );
    this.id = id;
    this.count = count;
  }
}
