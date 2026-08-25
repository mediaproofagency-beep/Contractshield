/**
 * Adaptateur console.
 *
 * Écrit le post sur la sortie standard et ne contacte rien. C'est ce qui permet
 * d'exercer la chaîne complète (claim, bail, quota, audit, marquage) sans compte
 * LinkedIn ni jeton, donc de tester l'ordonnanceur pour de vrai plutôt que de
 * l'admirer en lecture.
 */

import type { ContentItem } from '../domain/types.ts';
import type { ChannelCapability, Publisher, PublishContext, PublishResult } from './types.ts';

export class ConsolePublisher implements Publisher {
  readonly channel = 'linkedin' as const;
  readonly supportedFormats = ['duel', 'clause', 'cas_usage'] as const;

  async capabilities(ctx: PublishContext): Promise<ChannelCapability> {
    return { canDirectPublish: true, reason: 'adaptateur console', probedAt: ctx.now };
  }

  async validate(item: ContentItem, _ctx: PublishContext): Promise<{ ok: boolean; errors: string[] }> {
    return item.body.trim() === ''
      ? { ok: false, errors: ['Corps vide.'] }
      : { ok: true, errors: [] };
  }

  async publish(item: ContentItem, ctx: PublishContext): Promise<PublishResult> {
    // Tout passe par ctx.log : un test peut faire taire l'adaptateur, et la
    // redaction des jetons du contexte s'applique aussi ici.
    ctx.log(`console: item ${item.id}`, {
      format: item.format,
      length: item.body.length,
      body: item.body,
    });
    return {
      ok: true,
      mode: 'draft',
      status: 'done',
      retryable: false,
      externalId: `console:${item.id}`,
      degraded: { reason: 'adaptateur console, rien n\'a été publié' },
    };
  }
}
