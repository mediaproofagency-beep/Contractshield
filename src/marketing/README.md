# Marketing ContractShield — Phases 1 et 2

Phase 1 : génération ancrée sur une banque d'angles, et validation humaine.
Phase 2 : diffusion LinkedIn, ordonnanceur cron et limitation de débit.

**Un seul canal est branché : LinkedIn.** Brevo est déclaré mais n'a pas
d'adaptateur, et le registre le dit au démarrage plutôt qu'au moment de publier.

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
| `npm run marketing:tick -- --dry-run` | un passage de publication, affiche le payload LinkedIn sans rien envoyer |
| `npm run marketing:tick -- --console` | un passage complet avec l'adaptateur local |
| `npm run marketing -- oauth:login linkedin` | URL d'autorisation à trois pattes |
| `npm run marketing -- oauth:callback <code>` | échange le code, enregistre le jeton |
| `npm run marketing -- oauth:status` | échéance du jeton |
| `npm run marketing -- db:print-ddl --phase2` | migration additive de la phase 2 |
| `npm test` | 84 tests |
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
src/oauth/       chiffrement, OAuth trois pattes, renouvellement
src/publisher/   contrat, adaptateur LinkedIn, adaptateur console, registre
src/scheduler/   tick cron, quotas et recul exponentiel
src/notify.ts    alertes et digest
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


## Phase 2 — diffusion LinkedIn

### Mise en service, dans cet ordre

```bash
# 1. Voir ce qui partirait, sans jeton ni réseau.
npm run marketing:tick -- --dry-run

# 2. Générer la clé de chiffrement des jetons, la mettre dans .env
node -e "console.log('1:'+require('crypto').randomBytes(32).toString('base64'))"

# 3. Autoriser LinkedIn (trois pattes), puis échanger le code
npm run marketing -- oauth:login linkedin
npm run marketing -- oauth:callback <le code du redirect>

# 4. Vérifier ce que LinkedIn a réellement délivré
npm run marketing -- oauth:status
```

L'étape 4 n'est pas une formalité : **rien ne garantit qu'un refresh token soit
délivré**. `oauth:login` affiche lequel des deux régimes s'applique. Sans refresh
token, le canal s'éteint au bout de 60 jours et il faut se reconnecter à la main,
avec alertes à J-14, J-7 et J-3. Le découvrir maintenant coûte deux minutes, le
découvrir au jour 60 coûte un canal muet.

### Le premier post réel se fait sous surveillance

On ne peut pas tester une publication LinkedIn sans publier. La procédure :

1. `npm run marketing:tick -- --dry-run` et relire le payload à l'écran ;
2. vérifier que `LINKEDIN_API_VERSION` est une version encore supportée ;
3. regarder le champ `commentary` : s'il contient des barres obliques devant les
   parenthèses et les underscores des URL, c'est attendu ; si le post publié les
   affiche visiblement, passer `LINKEDIN_ESCAPE_COMMENTARY=false` ;
4. lancer un tick réel, un lundi matin, devant l'écran ;
5. ouvrir le profil LinkedIn et vérifier le rendu.

### Cron

```cron
# Toutes les 15 minutes, en UTC. Le quota interne limite à un post par jour :
# la fréquence du cron ne détermine pas le volume publié.
*/15 * * * * cd /srv/contractshield/src/marketing && TZ=UTC npm run marketing:tick >> /var/log/marketing-tick.log 2>&1
```

Couper la diffusion sans déployer : `MARKETING_ENABLED=false`.

### Ce que l'ordonnanceur garantit

1. **Il ne lit que `approved` et `scheduled`.** Un item en revue est invisible
   pour lui, et un test le vérifie pour chaque statut.
2. **Un item n'est publié qu'une fois.** Le verrou est un bail sur la ligne, posé
   par un UPDATE conditionnel dont on lit `affectedRows`. `GET_LOCK` de MariaDB
   n'est pas utilisé : il est lié à la connexion, pas à la transaction, et avec un
   pool la connexion qui verrouille n'est pas celle qui travaille. Un test lance
   deux ticks en parallèle et vérifie qu'un seul publie.
3. **Un worker mort ne provoque jamais de double post.** La tentative est écrite
   avant l'appel réseau. Un bail expiré sans publication renvoie l'item en revue
   avec la mention `needs_reconcile` et une alerte : un humain va voir le profil,
   la machine ne rejoue pas.
4. **Un post en retard ne part pas.** Au-delà de deux heures après l'heure prévue,
   l'item retourne en revue. Publier lundi un post pensé pour vendredi est pire
   que ne rien publier.
5. **Un arriéré ne part pas d'un coup.** Le quota quotidien est vérifié avant de
   lire la file : worker arrêté 48 h, un seul post repart.
6. **Une erreur d'authentification met le canal en pause.** Aucune reprise en
   boucle avec un jeton mort.
7. **Un 429 est respecté.** `Retry-After` de LinkedIn prime sur notre propre
   recul exponentiel, plafonné à trois tentatives.
8. **Les jetons sont chiffrés au repos** (AES-256-GCM, IV et tag stockés à part,
   version de clé pour permettre la rotation) et masqués dans tous les logs.

### Deux points non vérifiés

L'environnement de développement de cette session n'a pas d'accès réseau sortant
vers LinkedIn : le code n'a jamais parlé à l'API réelle.

- **`LINKEDIN_API_VERSION`** : la valeur par défaut `202601` doit être confirmée.
  Une version périmée donne un 400, classé `validation`, avec la commande de
  diagnostic dans le message.
- **L'échappement de `commentary`** : implémenté selon la règle du petit texte,
  basculable par variable d'environnement si le rendu réel le dément.

Le dépôt MariaDB n'a pas davantage été exécuté : pas de MariaDB dans cet
environnement. Les 84 tests tournent contre le dépôt mémoire, qui respecte les
mêmes garanties conditionnelles.
