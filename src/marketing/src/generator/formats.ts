/**
 * Assemblage du corps final.
 *
 * Le modèle produit quatre fragments. C'est ici que le post est monté, et c'est
 * ici, pas dans le prompt, que sont injectés :
 *  - les citations d'articles, reprises telles quelles des `legal_refs` ;
 *  - les URL Légifrance, que le modèle n'a jamais vues ;
 *  - la mention légale obligatoire.
 *
 * Conséquence directe : le modèle n'a aucune occasion d'inventer un lien, et le
 * validateur devient une seconde barrière au lieu d'être la seule.
 */

import type { ContentAngle, Format } from '../domain/types.ts';
import type { GeneratedParts } from './mistral.ts';
import { LEGAL_MENTION } from './validate.ts';

export interface FormatInput {
  parts: GeneratedParts;
  angle: ContentAngle;
  format: Format;
}

function refsBlock(angle: ContentAngle): string {
  return angle.legalRefs
    .map((r) => `${r.code}, article ${r.article}\n${r.url}`)
    .join('\n\n');
}

export function assembleBody({ parts, angle, format }: FormatInput): string {
  const blocks: string[] = [parts.accroche];

  if (format === 'duel') {
    blocks.push(
      parts.corps,
      `Ce que répond un assistant généraliste :\n${parts.contraste}`,
      `Ce que dit le texte :\n${refsBlock(angle)}`,
      `À demander :\n${parts.aDemander}`,
    );
  } else if (format === 'clause') {
    blocks.push(
      parts.corps,
      `Le texte applicable :\n${refsBlock(angle)}`,
      `À demander :\n${parts.aDemander}`,
    );
  } else {
    blocks.push(
      parts.corps,
      parts.contraste,
      `À demander :\n${parts.aDemander}`,
      `Référence :\n${refsBlock(angle)}`,
    );
  }

  blocks.push(LEGAL_MENTION);
  return blocks
    .map((b) => b.trim())
    .filter((b) => b.length > 0)
    .join('\n\n');
}
