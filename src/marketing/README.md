# Marketing ContractShield — Phase 1

Génération de contenu ancrée sur une banque d'angles, et validation humaine.
**Aucun adaptateur de publication.** Rien ne peut partir : c'est le point.

Plan de référence : [`docs/plans/systeme-marketing-contractshield.md`](../../docs/plans/systeme-marketing-contractshield.md).

## Démarrer

```bash
npm install
npm run marketing:demo      # seed + 5 items + résumé, sans base ni clé API
npm run marketing:review    # http://127.0.0.1:4321/admin/marketing
```

Aucun secret, aucune base, aucun conteneur. `MISTRAL_MODE=fixture` rejoue une
réponse locale ; c'est ce qui rend le premier lancement possible en quelques
secondes plutôt qu'en quelques heures.

Pour générer avec le vrai modèle : `MISTRAL_MODE=api MISTRAL_API_KEY=… npm run marketing:demo`.

## Commandes

| Commande | Effet |
|---|---|
| `npm run marketing:demo [n]` | seed, génère n items (défaut 5), affiche la file et le premier post |
| `npm run marketing:generate [n]` | génère n items |
| `npm run marketing:queue` | état de la file |
| `npm run marketing:doctor` | ce qui est configuré, ce qui manque, quoi faire |
| `npm run marketing -- db:print-ddl` | DDL MariaDB des deux tables |
| `npm test` | 44 tests |
| `npm run typecheck` | TypeScript strict |

## Ce que le système garantit

1. **Rien ne part sans validation humaine.** La machine à états n'a aucune
   transition vers `scheduled` qui ne passe pas par `approved`, et `approved` ne
   s'obtient que par une action dans la file. Un test vérifie chaque transition
   interdite, pas seulement le chemin nominal.
2. **Une citation fausse ne peut pas être approuvée.** Le validateur compare tout
   article et toute URL du corps aux références de l'angle. Un item qui échoue
   reste en `draft`, visible dans l'onglet « Bloqués », avec le bouton Approuver
   désactivé et la raison affichée.
3. **L'édition humaine ne contourne pas le validateur.** Un corps réécrit repasse
   par la même vérification, et retombe en `draft` s'il introduit un article
   inventé. C'était la porte dérobée la plus évidente du système.
4. **Le modèle n'écrit jamais une URL.** Liens Légifrance et mention légale sont
   injectés par le formatter à partir des références de l'angle. Le modèle n'a
   donc aucune occasion d'inventer un lien, et le validateur est une seconde
   barrière plutôt que la seule.
5. **Le payload d'un angle est une donnée, jamais une instruction.** Il arrive
   délimité dans le prompt, avec consigne explicite de ne rien y obéir. Les angles
   viennent de textes de loi et de contrats-types : du texte que nous ne
   contrôlons pas.
6. **Le double-clic ne peut pas approuver deux fois.** Chaque transition est un
   update conditionnel sur le statut attendu ; le perdant touche zéro ligne et
   reçoit un message clair au lieu d'écraser la décision du gagnant.
7. **Le générateur n'invente pas de sujet.** Banque d'angles vide, il alerte et
   ne produit rien.

## Interface de validation

Hiérarchie imposée, dans cet ordre : verdict du validateur, post tel qu'il
apparaîtra, références cliquables, métadonnées. Le format `duel` s'affiche en deux
colonnes, parce que l'écart avec un assistant généraliste est la démonstration
produit et qu'une zone de texte unique le cache.

Clavier : `J` / `K` naviguer, `A` approuver (annulable 5 s), `R` rejeter avec un
motif en liste courte, `E` éditer, `Échap` sortir, `?` l'aide. Les raccourcis sont
neutralisés dans les champs de saisie, et chaque action a son équivalent souris.

## Structure

```
src/domain/      types, machine à états, erreurs typées, hash normalisé
src/db/          schéma Drizzle MariaDB + DDL de référence
src/repo/        interface, implémentation mémoire, implémentation MariaDB
src/angles/      seed et sélection
src/generator/   prompt ancré, client Mistral, formats, validateur
src/review/      service de la file
src/server/      serveur de la page de validation
src/ui/          la page
```

## Limites assumées

- **Le dépôt MariaDB n'a pas été exécuté.** Aucune MariaDB dans l'environnement de
  développement de cette session. Le code est écrit et typé, les tests tournent
  contre le dépôt mémoire. Premier passage sur une vraie base à prévoir.
- **Les URL de seed sont des recherches Légifrance, pas des identifiants
  LEGIARTI.** Elles fonctionnent et n'inventent rien. L'ingest PISTE les
  remplacera par les URL canoniques.
- **Trois angles seulement.** C'est la banque réelle tant qu'il n'y a pas
  d'analyses à agréger. Trois angles fois trois formats donnent neuf
  publications distinctes, assez pour une semaine.
- **Pas de routes tRPC.** Le backend applicatif n'est pas dans ce dépôt (question
  ouverte n°2 du design doc). Le service de revue est exposé par une API JSON ;
  le brancher sur tRPC est un adaptateur d'une vingtaine de lignes qui appelle
  les mêmes méthodes.
- **Le serveur de démo garde tout en mémoire.** Redémarrage, file vide.
