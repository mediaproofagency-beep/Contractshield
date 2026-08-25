# Brief Claude Code — Campagne maquettes offertes / restaurants bordelais

**Commanditaire :** MediaProof Agency (Pessac)
**Objectif :** 10 restaurants bordelais sans site web → une maquette sur mesure chacun → un email de prospection qui donne envie de cliquer.
**Entrée :** `prospects-bordeaux.json` (15 candidats, pour en retenir 10)

---

## Ce qui a déjà été fait, et ce qui ne l'a pas été

Deux prospects sont **vérifiés** : Le Guet-A-Pan (aucun site propre, seulement une page `eatbu.com` auto-générée) et Chez Ludo (aucun site, Facebook uniquement). Les treize autres sont des **candidats plausibles non vérifiés** — l'API de recherche utilisée ne renvoie pas le champ `website`.

**Aucun email ne part avant que la phase 1 ait confirmé l'absence de site.** Envoyer « j'ai vu que vous n'aviez pas de site » à quelqu'un qui en a un tue le prospect et la crédibilité de l'agence.

---

## Phase 1 — Vérifier et enrichir

Pour chaque `place_id`, appeler **Places Details API (v1)** avec le field mask :

```
places.displayName,places.websiteUri,places.nationalPhoneNumber,places.formattedAddress,places.rating,places.userRatingCount,places.priceLevel,places.regularOpeningHours,places.reviews,places.photos,places.editorialSummary,places.primaryType
```

Classer chaque prospect :

| Verdict | Critère | Action |
|---|---|---|
| `CIBLE` | `websiteUri` absent | Garder |
| `CIBLE_FAIBLE` | `websiteUri` pointe vers Facebook, Instagram, eatbu, placejoys, un agrégateur ou une page « en construction » | Garder — argumentaire adapté (voir variante B) |
| `EXCLU` | Vrai domaine propre et site vivant | Sortir de la liste |

Vérifier aussi le domaine évident (`nomdurestaurant.fr` / `.com`) : certains sites existent sans être déclarés sur Google.

**S'arrêter à 10 `CIBLE` / `CIBLE_FAIBLE`.** Si moins de 10 sortent des 15, élargir avec `places_search` sur Saint-Pierre, Nansouty, Caudéran, Talence, Bègles — mêmes filtres : moins de 700 avis, note ≥ 4.3, téléphone mobile ou 09 (signal de petite structure indépendante).

Sortie : `data/cibles.json`.

---

## Phase 2 — Images : à lire avant de coder

**Les photos Google Places ne peuvent pas être utilisées ici.** Les conditions Google interdisent de les stocker et de les réafficher hors d'un contexte Google Maps. Une maquette commerciale envoyée par email est exactement ce cas. Deux conséquences : risque juridique, et les photos sont souvent des clichés clients au smartphone qui desservent la maquette.

Trois sources acceptables, dans l'ordre :

1. **Photos du restaurant lui-même** — page Facebook/Instagram publique. À utiliser uniquement pour la maquette de démonstration envoyée au propriétaire (c'est son propre contenu, on le lui montre à lui), jamais pour une mise en ligne publique. Créditer dans le pied de maquette : « Visuels provenant de votre page Facebook, à remplacer par un reportage photo. »
2. **Banque libre** — Unsplash / Pexels, sélectionnées par thème (fruits de mer, trattoria, bistrot de nuit…). Marquer chaque image `data-placeholder="true"`.
3. **Traitement graphique sans photo** — typographie, couleur, textures, illustrations SVG. Souvent le meilleur choix : ça montre le design sans prétendre montrer leur cuisine.

Générer aussi `assets/PHOTO-SOURCES.md` traçant chaque image et son origine.

---

## Phase 3 — Les maquettes

Un dossier par restaurant : `maquettes/<slug>/index.html`. **Un seul fichier HTML autonome** (CSS et JS inline, polices via Google Fonts CDN) — il doit s'ouvrir depuis un simple double-clic ou un lien.

### Règle centrale : dix maquettes, dix identités

Le piège est de produire dix fois le même template avec un logo différent. C'est précisément ce qui fait perdre la vente : le restaurateur sent le gabarit.

Avant de coder chaque maquette, écrire dans `maquettes/<slug>/DESIGN-NOTES.md` :

- **Sujet** — en une phrase, ce qu'est ce restaurant et pour qui
- **Palette** — 4 à 6 hex nommés, dérivés de la thématique réelle
- **Typographie** — une display avec caractère + une body, différentes d'une maquette à l'autre
- **Layout** — concept en une phrase + wireframe ASCII
- **Signature** — l'élément unique dont on se souviendra

Puis relire ces notes : *si cette page pouvait servir à un autre restaurant de la liste, la refaire.*

À éviter absolument, ce sont les défauts de l'IA générative en design : fond crème #F4F1EA + serif contrasté + accent terracotta ; fond noir + accent vert acide ; colonnes type journal avec filets fins. Trois looks qui reviennent quel que soit le sujet.

### Ancrages par prospect

Chaque maquette part de quelque chose de vrai, tiré du JSON :

- **Chez Ludo** — le sujet, c'est 22h-4h. Une page qui s'assume nocturne, où l'heure compte. Pas un bistrot générique avec un fond sombre.
- **Le Guet-A-Pan** — le four Josper et les produits achetés aux voisins du marché. La géographie du marché est le contenu.
- **Chez Jean-Mi** — 6 huîtres + un verre à 11 €. Le prix est l'argument, il doit être visible avant tout le reste.
- **L'assiette du coin** — menu qui change chaque semaine. Une page dont la structure rend ce changement facile à publier.
- **L'Oustaou** — troquet landais. Le vocabulaire du Sud-Ouest, pas un placage de couleurs régionales.

Même travail pour les autres à partir de `thematique` et `signaux`.

### Contenu

Pas de lorem ipsum. Écrire de vrais textes à partir des avis et de la thématique — c'est ce qui fait sentir au restaurateur que quelqu'un a compris son établissement. Horaires, adresse, téléphone : les vrais, depuis le JSON.

Marquer visiblement en pied de page : *Maquette de démonstration — MediaProof Agency. Textes et visuels à valider.*

### Plancher de qualité

Responsive jusqu'à 360px (la majorité ouvriront le lien sur mobile), focus clavier visible, `prefers-reduced-motion` respecté, contraste AA, chargement sous 2s.

---

## Phase 4 — Trouver les emails

Ordre de recherche, en s'arrêtant au premier résultat :

1. Fiche Google (`editorialSummary`, posts)
2. Page Facebook → section Informations
3. Bio Instagram
4. Annuaires : societe.com, infobel, pagesjaunes, restaurants-de-france
5. `contact@<domaine>` si un domaine existe sans site

**Ne pas deviner d'adresses.** `contact@nomduresto.fr` inventé au hasard génère des bounces qui dégradent la réputation d'envoi. Si aucun email n'est trouvé — cas fréquent, Chez Ludo par exemple — basculer sur `data/contacts-alternatifs.json` : Messenger, Instagram DM, ou passage physique. Un restaurateur de quartier répond souvent mieux à quelqu'un qui pousse la porte à 15h avec un iPad.

Sortie : `data/contacts.json` avec `email`, `source`, `confiance` (haute / moyenne).

---

## Phase 5 — Emails

### Cadre légal — non négociable

La prospection B2B par email est licite en France sans consentement préalable, à condition que le message soit en rapport avec la fonction professionnelle du destinataire (position CNIL). Une offre de site web à un restaurateur entre dans ce cadre. Trois obligations en revanche :

- **Identification claire** de l'expéditeur : MediaProof Agency, adresse, SIREN
- **Lien de désinscription** fonctionnel dans chaque message
- **Information sur l'origine des données** : « coordonnées issues de votre fiche Google Business Profile »

Ajouter ces trois éléments dans le pied de chaque email. Toute demande de retrait est honorée immédiatement et l'adresse ajoutée à `data/blocklist.json`, vérifiée avant chaque envoi.

### Ne pas envoyer depuis Gmail

`mediaproofagency@gmail.com` en émission froide, c'est du gâchis : SPF/DKIM sur `gmail.com` ne prouvent rien pour une agence, les filtres classent le premier envoi en promotions ou en spam, et le compte peut être suspendu. Une agence web qui écrit depuis une adresse Gmail contredit aussi son propre argumentaire.

Configuration à mettre en place :

- Domaine d'envoi `mediaproofagency.fr` (ou le domaine existant), SPF + DKIM + DMARC
- Expéditeur `prenom@mediaproofagency.fr` — un nom, pas `contact@`
- Envoi via **Brevo**, déjà en place. Reply-to peut rester Gmail si nécessaire.
- **Maximum 5 à 8 envois par jour** sur un domaine neuf, montée progressive
- Chaque maquette hébergée sur le VPS Scaleway : `https://maquettes.mediaproofagency.fr/<slug>/`

Si le domaine n'est pas prêt, envoyer les dix à la main depuis Gmail sur trois jours. Dix emails écrits un par un passeront ; dix envoyés en batch par script finiront en spam.

### Structure du message

Contraintes : moins de 120 mots, un seul lien, pas de pièce jointe, pas d'image (déclenche les filtres), objet sans majuscules ni point d'exclamation.

L'accroche doit prouver en une phrase qu'on a regardé leur établissement — un plat cité dans les avis, une particularité d'horaires, le nom du patron. C'est le seul élément qui distingue ce message d'un mailing de masse.

**Variante A — aucun site**

> Objet : une page pour {Restaurant}
>
> Bonjour {Prénom},
>
> Je suis passé sur votre fiche Google — {détail spécifique}. Vos {N} avis en disent long, mais quand quelqu'un cherche « {cuisine} {quartier} », il n'y a rien à ouvrir.
>
> J'ai pris une heure pour dessiner ce à quoi pourrait ressembler votre site : {lien}
>
> C'est une maquette, pas un devis. Si ça ne vous parle pas, supprimez ce message. Si ça vous parle, on en discute dix minutes.
>
> {Prénom}, MediaProof Agency

**Variante B — page auto-générée ou Facebook seul**

Remplacer le deuxième paragraphe : « Vous avez bien une page en ligne, mais c'est un modèle standard qu'on retrouve sur des centaines d'établissements. La vôtre pourrait ressembler à ça : »

**Relance à J+6, une seule**

> Objet : Re: une page pour {Restaurant}
>
> Bonjour {Prénom}, je remonte mon message au cas où. La maquette reste en ligne quinze jours : {lien}. Sans réponse je n'insiste pas. Bonne continuation.

### Suivi

`data/campagne.json` : statut, date d'envoi, ouvertures, clics, réponses. Le clic sur la maquette est le vrai signal — une ouverture ne vaut rien, un clic veut dire qu'il a regardé.

---

## Arborescence attendue

```
campagne-bordeaux/
├── data/
│   ├── prospects-bordeaux.json
│   ├── cibles.json
│   ├── contacts.json
│   ├── contacts-alternatifs.json
│   ├── blocklist.json
│   └── campagne.json
├── maquettes/
│   └── <slug>/
│       ├── index.html
│       └── DESIGN-NOTES.md
├── assets/PHOTO-SOURCES.md
├── emails/<slug>.txt
└── scripts/
    ├── 1-verifier.py
    ├── 2-contacts.py
    └── 3-envoyer.py
```

## Ordre d'exécution

Phases 1, 2, 4 automatisables. **Phase 3 non.** Dix maquettes distinctes demandent dix sessions de design séparées — une boucle qui les génère d'un coup produira dix variantes du même template, ce qui fait échouer la campagne.

`3-envoyer.py` tourne en `--dry-run` par défaut et écrit les messages dans `emails/`. Relire les dix avant d'armer l'envoi réel.

---

## Le vrai indicateur

Dix maquettes, un ou deux rendez-vous. C'est le taux normal, et c'est suffisant : un site restaurant se facture assez pour qu'une conversion rembourse la campagne. L'erreur serait d'augmenter le volume au détriment du soin — ce qui vend ici, c'est que le restaurateur voie son propre établissement dans la maquette.
