/**
 * Orchestration de la génération.
 *
 *   angle → prompt ancré → Mistral → assemblage → validateur → file
 *
 * Un item validé arrive en `pending_review`. Un item qui échoue au validateur
 * reste en `draft` avec ses erreurs : il apparaît dans l'onglet « bloqués » de la
 * file, il n'est jamais approuvable, et il n'est jamais silencieux.
 */

import { bodyHash } from '../domain/hash.ts';
import type { Channel, ContentItem, Format } from '../domain/types.ts';
import { selectAngle, type SelectOptions } from '../angles/select.ts';
import type { MarketingRepo } from '../repo/types.ts';
import { assembleBody } from './formats.ts';
import { createClient, type MistralClient } from './mistral.ts';
import { buildUserPrompt, generatorTag, SYSTEM_PROMPT } from './prompt.ts';
import { validateBody } from './validate.ts';

export interface GenerateOneInput {
  repo: MarketingRepo;
  client?: MistralClient;
  channel?: Channel;
  format?: Format;
  angleId?: number;
  select?: SelectOptions;
  now?: Date;
}

export interface GenerateResult {
  item: ContentItem;
  /** Vrai quand le validateur a bloqué l'item en `draft`. */
  blocked: boolean;
  /** Vrai quand un item identique existait déjà sur ce canal. */
  duplicate: boolean;
}

export async function generateOne(input: GenerateOneInput): Promise<GenerateResult> {
  const {
    repo,
    client = createClient(),
    channel = 'linkedin',
    format = 'duel',
    now = new Date(),
  } = input;

  const angle = input.angleId
    ? await repo.getAngle(input.angleId)
    : await selectAngle(repo, { ...input.select, now });
  if (!angle) throw new Error(`Angle ${input.angleId} introuvable.`);

  const parts = await client.complete(SYSTEM_PROMPT, buildUserPrompt({ angle, format }));
  const body = assembleBody({ parts, angle, format });

  const hash = bodyHash(body);
  const existing = await repo.findItemByHash(channel, hash);
  if (existing) {
    await repo.markAngleUsed(angle.id, now);
    return { item: existing, blocked: existing.status === 'draft', duplicate: true };
  }

  const errors = validateBody({ body, channel, angle });
  const item = await repo.insertItem({
    angleId: angle.id,
    channel,
    format,
    body,
    generatedBy: generatorTag(client.model),
    validationErrors: errors.length > 0 ? errors : null,
  });

  await repo.markAngleUsed(angle.id, now);
  return { item, blocked: errors.length > 0, duplicate: false };
}

export interface GenerateBatchInput extends Omit<GenerateOneInput, 'angleId'> {
  /** Nombre d'items à produire. Une semaine ouvrée vaut 5. */
  count: number;
  formats?: readonly Format[];
}

/**
 * Produit un lot.
 *
 * Le lot parcourt les couples (angle, format) plutôt que les angles seuls : trois
 * angles et trois formats donnent neuf publications distinctes, ce qui suffit à
 * une semaine sans réutiliser deux fois le même couple. Un même couple n'est
 * jamais servi deux fois dans un lot, et l'anti-doublon rattrape le reste.
 *
 * Une panne sur un item n'arrête pas les suivants : les échecs sont renvoyés tels
 * quels pour être affichés, jamais avalés.
 */
export async function generateBatch(
  input: GenerateBatchInput,
): Promise<{ results: GenerateResult[]; failures: Error[] }> {
  const { count, formats = ['duel', 'clause', 'cas_usage'], repo, ...rest } = input;
  const results: GenerateResult[] = [];
  const failures: Error[] = [];

  const angles = await repo.listActiveAngles();
  if (angles.length === 0) {
    // Une seule erreur, claire, plutôt que `count` erreurs identiques.
    const { NoActiveAngleError } = await import('../domain/errors.ts');
    return { results, failures: [new NoActiveAngleError()] };
  }

  const pairs: { angleId: number; format: Format }[] = [];
  for (let f = 0; f < formats.length; f++) {
    for (const angle of angles) {
      const format = formats[f];
      if (format) pairs.push({ angleId: angle.id, format });
    }
  }

  for (let i = 0; i < count; i++) {
    const pair = pairs[i % pairs.length];
    if (!pair) break;
    try {
      results.push(await generateOne({ ...rest, repo, angleId: pair.angleId, format: pair.format }));
    } catch (err) {
      failures.push(err instanceof Error ? err : new Error(String(err)));
    }
  }

  return { results, failures };
}
