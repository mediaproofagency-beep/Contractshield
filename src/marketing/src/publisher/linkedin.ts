/**
 * Adaptateur LinkedIn — POST /rest/posts.
 *
 * `ugcPosts` est déprécié, on ne l'utilise pas. L'API Posts exige trois choses
 * qu'on ne peut pas oublier :
 *   - `LinkedIn-Version: AAAAMM`, la version d'API, obligatoire ;
 *   - `X-Restli-Protocol-Version: 2.0.0` ;
 *   - `author` en `urn:li:person:{sub}`, récupéré via /v2/userinfo.
 *
 * Deux points à confirmer avant la première publication réelle, non vérifiables
 * depuis l'environnement de développement de cette session (sortie réseau bloquée
 * vers la documentation LinkedIn) :
 *   1. la valeur de `LINKEDIN_API_VERSION` doit être une version encore supportée
 *      (elles tournent tous les trimestres) ;
 *   2. l'échappement du champ `commentary` : LinkedIn traite ce champ comme du
 *      « petit texte » où une série de caractères doit être précédée d'une barre
 *      oblique inverse. `escapeCommentary` implémente cette règle ; si la liste a
 *      changé, un post part avec des barres visibles.
 * Le mode `--dry-run` existe pour vérifier ces deux points sur le payload réel
 * avant d'envoyer quoi que ce soit.
 */

import type { ContentItem } from '../domain/types.ts';
import { MAX_BODY } from '../generator/validate.ts';
import { failure, type ChannelCapability, type Publisher, type PublishContext, type PublishResult } from './types.ts';

export const POSTS_URL = 'https://api.linkedin.com/rest/posts';

/** Caractères réservés du format « petit texte » de LinkedIn. */
const RESERVED = /[\\|{}@\[\]()<>#*_~]/g;

/**
 * Échappe le corps pour le champ `commentary`.
 * La barre oblique inverse est traitée en premier par le jeu de caractères de la
 * regex, sinon on échapperait les barres qu'on vient d'ajouter.
 */
export function escapeCommentary(body: string): string {
  return body.replace(RESERVED, (c) => `\\${c}`);
}

export interface LinkedInAuth {
  /** Access token en clair, obtenu juste avant l'appel. Jamais journalisé. */
  accessToken: string;
  /** `urn:li:person:{sub}`. */
  authorUrn: string;
}

export interface LinkedInOptions {
  apiVersion: string;
  /** Fourni par le tick : renouvelle le jeton si besoin. */
  getAuth: () => Promise<LinkedInAuth>;
  postsUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /**
   * Échappement du champ `commentary`.
   *
   * La règle du « petit texte » est documentée côté LinkedIn mais n'a pas pu être
   * vérifiée dans cet environnement. Le pari est risqué dans les deux sens :
   * ne pas échapper peut faire refuser le post, échapper à tort le fait partir
   * avec des barres obliques visibles dans les URL et les parenthèses.
   * Ce drapeau permet de trancher après le premier post réel sans toucher au code.
   */
  escapeCommentaryField?: boolean;
}

export class LinkedInPublisher implements Publisher {
  readonly channel = 'linkedin' as const;
  /** Pas de vidéo ici : les formats texte uniquement. */
  readonly supportedFormats = ['duel', 'clause', 'cas_usage'] as const;

  private readonly opts: LinkedInOptions;
  private readonly escape: boolean;

  constructor(opts: LinkedInOptions) {
    this.opts = opts;
    this.escape = opts.escapeCommentaryField ?? true;
  }

  private commentaryOf(body: string): string {
    return this.escape ? escapeCommentary(body) : body;
  }

  /**
   * LinkedIn publie directement dès que `w_member_social` est accordé : il n'y a
   * pas d'audit préalable comme sur TikTok. La capacité est donc conditionnée au
   * seul jeton, et une panne d'authentification se voit ici plutôt qu'au milieu
   * d'une publication.
   */
  async capabilities(ctx: PublishContext): Promise<ChannelCapability> {
    if (ctx.dryRun) {
      return { canDirectPublish: true, reason: 'dry-run', probedAt: ctx.now };
    }
    try {
      await this.opts.getAuth();
      return { canDirectPublish: true, probedAt: ctx.now };
    } catch (err) {
      return {
        canDirectPublish: false,
        reason: err instanceof Error ? err.message : String(err),
        probedAt: ctx.now,
      };
    }
  }

  async validate(item: ContentItem, _ctx: PublishContext): Promise<{ ok: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (item.body.trim() === '') errors.push('Corps vide.');
    // L'échappement rallonge le texte : c'est la longueur envoyée qui compte.
    const escaped = this.commentaryOf(item.body);
    if (escaped.length > MAX_BODY.linkedin) {
      errors.push(
        `Corps de ${escaped.length} caractères après échappement, limite LinkedIn ${MAX_BODY.linkedin}.`,
      );
    }
    if (!this.supportedFormats.includes(item.format)) {
      errors.push(`Format ${item.format} non supporté par LinkedIn.`);
    }
    return { ok: errors.length === 0, errors };
  }

  async publish(item: ContentItem, ctx: PublishContext): Promise<PublishResult> {
    const pre = await this.validate(item, ctx);
    if (!pre.ok) {
      return failure('validation', pre.errors.join(' '), 'Édite le corps dans la file.', {
        retryable: false,
      });
    }

    let auth: LinkedInAuth | null = null;
    let authError: { detail: string; remediation: string } | null = null;
    try {
      auth = await this.opts.getAuth();
    } catch (err) {
      authError = {
        detail: err instanceof Error ? err.message : String(err),
        remediation:
          (err as { remediation?: string }).remediation ??
          'Reconnecte LinkedIn : `npm run marketing -- oauth:login linkedin`.',
      };
    }

    /*
     * En dry-run, l'absence de jeton n'empêche pas d'afficher le payload : c'est
     * exactement le moment où on veut vérifier la version d'API et l'échappement,
     * avant même d'avoir configuré OAuth. L'URN est alors un marqueur explicite.
     */
    if (ctx.dryRun) {
      const authorUrn = auth?.authorUrn ?? 'urn:li:person:AUTEUR-NON-RESOLU';
      ctx.log('dry-run: payload LinkedIn non envoyé', {
        itemId: item.id,
        apiVersion: this.opts.apiVersion,
        authResolved: auth != null,
        authError: authError?.detail,
        escapeCommentary: this.escape,
        payload: buildPostPayload(item, authorUrn, this.escape),
      });
      return {
        ok: true,
        mode: 'draft',
        status: 'done',
        retryable: false,
        degraded: {
          reason: auth
            ? "dry-run, rien n'a été publié"
            : "dry-run sans jeton : payload affiché avec un auteur fictif",
        },
        externalId: `dry-run:${item.id}`,
      };
    }

    if (!auth) {
      return failure('auth', authError!.detail, authError!.remediation, { retryable: false });
    }

    const payload = buildPostPayload(item, auth.authorUrn, this.escape);
    const doFetch = this.opts.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 20_000);

    let res: Response;
    try {
      res = await doFetch(this.opts.postsUrl ?? POSTS_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${auth.accessToken}`,
          'content-type': 'application/json',
          'LinkedIn-Version': this.opts.apiVersion,
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      return failure(
        'network',
        aborted ? 'Délai dépassé.' : err instanceof Error ? err.message : String(err),
        'Le tick réessaiera. Trois échecs consécutifs déclenchent une alerte.',
        { retryable: true },
      );
    } finally {
      clearTimeout(timer);
    }

    return interpretResponse(res, await res.text().catch(() => ''), item.id);
  }
}

/** Corps de la requête /rest/posts, membre, texte seul, visibilité publique. */
export function buildPostPayload(
  item: ContentItem,
  authorUrn: string,
  escape = true,
): Record<string, unknown> {
  return {
    author: authorUrn,
    commentary: escape ? escapeCommentary(item.body) : item.body,
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };
}

/**
 * Traduit la réponse HTTP en résultat typé.
 * Chaque classe d'erreur porte sa remédiation : à 7 h du matin, « auth » tout seul
 * oblige à ouvrir la base pour comprendre.
 */
export function interpretResponse(
  res: { status: number; headers: { get(name: string): string | null } },
  body: string,
  itemId: number,
): PublishResult {
  const status = res.status;

  if (status === 201 || status === 200) {
    // L'URN du post arrive en en-tête, pas dans le corps.
    const urn = res.headers.get('x-restli-id') ?? res.headers.get('x-linkedin-id');
    if (!urn) {
      // Publié mais non identifiable : surtout ne pas rejouer, un humain tranche.
      return {
        ok: false,
        mode: 'direct',
        status: 'done',
        retryable: false,
        errorClass: 'platform',
        errorDetail: "LinkedIn a accepté le post sans renvoyer d'identifiant (x-restli-id).",
        responseCode: status,
        remediation:
          `Vérifie ton profil LinkedIn : l'item ${itemId} est probablement en ligne. ` +
          'Marque-le publié à la main plutôt que de le renvoyer.',
      };
    }
    return { ok: true, mode: 'direct', status: 'done', retryable: false, externalId: urn, responseCode: status };
  }

  if (status === 401 || status === 403) {
    return failure(
      'auth',
      `LinkedIn a répondu ${status} : ${body.slice(0, 200)}`,
      'Reconnecte LinkedIn : `npm run marketing -- oauth:login linkedin`. Le canal est mis en pause.',
      { retryable: false, responseCode: status },
    );
  }

  if (status === 429) {
    const retryAfter = Number(res.headers.get('retry-after'));
    return {
      ...failure(
        'rate_limit',
        `Quota LinkedIn atteint. ${body.slice(0, 200)}`,
        'Rien à faire : le tick reprendra après la fenêtre de quota.',
        { retryable: true, responseCode: status },
      ),
      pollAfter: Number.isFinite(retryAfter)
        ? new Date(Date.now() + retryAfter * 1000)
        : undefined,
    };
  }

  if (status >= 500) {
    return failure(
      'platform',
      `LinkedIn a répondu ${status} : ${body.slice(0, 200)}`,
      'Panne côté LinkedIn. Le tick réessaiera trois fois.',
      { retryable: true, responseCode: status },
    );
  }

  // 4xx restants : la requête est en cause, la rejouer telle quelle ne sert à rien.
  return failure(
    'validation',
    `LinkedIn a refusé la requête (${status}) : ${body.slice(0, 300)}`,
    "Vérifie LINKEDIN_API_VERSION et le corps du post. `marketing publish --dry-run --id " +
      `${itemId}\` affiche le payload exact envoyé.`,
    { retryable: false, responseCode: status },
  );
}
