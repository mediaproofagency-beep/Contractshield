/**
 * Registre des adaptateurs.
 *
 * Ajouter un canal : un fichier voisin, une ligne ici, une valeur dans l'enum
 * `channel` et sa migration. `assertRegistryComplete` vérifie au démarrage que
 * chaque valeur de l'enum a bien un adaptateur : sans ce contrôle, un canal
 * oublié fait lever le tick toutes les minutes en production.
 */

import { CHANNELS, type Channel } from '../domain/types.ts';
import { ConsolePublisher } from './console.ts';
import { LinkedInPublisher } from './linkedin.ts';
import type { Publisher } from './types.ts';
import { ensureAccessToken } from '../oauth/store.ts';
import { configFromEnv, fetchPersonUrn } from '../oauth/linkedin.ts';
import type { MarketingRepo } from '../repo/types.ts';

export interface RegistryOptions {
  repo: MarketingRepo;
  env?: NodeJS.ProcessEnv;
  /** Force l'adaptateur console, quel que soit le canal. */
  console?: boolean;
}

/**
 * Construit l'adaptateur d'un canal.
 *
 * L'URN auteur est résolue une fois puis mémorisée : elle ne change pas, et une
 * requête `userinfo` par publication serait un appel de plus à rater.
 */
export function createPublisher(channel: Channel, opts: RegistryOptions): Publisher {
  if (opts.console) return new ConsolePublisher();
  const env = opts.env ?? process.env;

  switch (channel) {
    case 'linkedin': {
      let cachedUrn: string | null = null;
      return new LinkedInPublisher({
        apiVersion: env.LINKEDIN_API_VERSION ?? '202601',
        // Par défaut on échappe. À basculer après vérification du premier post réel.
        escapeCommentaryField: env.LINKEDIN_ESCAPE_COMMENTARY !== 'false',
        getAuth: async () => {
          const { accessToken, accountRef } = await ensureAccessToken(opts.repo, configFromEnv(env));
          if (!cachedUrn) {
            cachedUrn = accountRef.startsWith('urn:li:person:')
              ? accountRef
              : await fetchPersonUrn(accessToken);
          }
          return { accessToken, authorUrn: cachedUrn };
        },
      });
    }
    case 'brevo':
      // Phase 2 couvre LinkedIn uniquement. Un canal sans adaptateur doit le dire
      // à la construction, pas au moment de publier.
      throw new Error(
        "Aucun adaptateur pour le canal `brevo` : la phase 2 ne couvre que LinkedIn. " +
          'Utilise `--console` pour exercer la chaîne sans publier.',
      );
    default: {
      const never: never = channel;
      throw new Error(`Canal inconnu : ${String(never)}`);
    }
  }
}

/** Canaux réellement implémentés. Le reste est déclaré mais pas branché. */
export const IMPLEMENTED_CHANNELS: readonly Channel[] = ['linkedin'];

export function assertRegistryComplete(): void {
  const missing = CHANNELS.filter((c) => !IMPLEMENTED_CHANNELS.includes(c));
  if (missing.length > 0) {
    // Informatif, pas bloquant : un canal déclaré sans adaptateur est un choix de
    // périmètre assumé tant qu'aucun contenu ne le vise.
    console.warn(
      `[registry] canaux déclarés sans adaptateur : ${missing.join(', ')}. ` +
        "Aucun contenu ne doit être approuvé sur ces canaux tant qu'ils ne sont pas branchés.",
    );
  }
}
