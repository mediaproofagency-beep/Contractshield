# Campagne maquettes offertes — restaurants bordelais

Dix restaurants sans site, dix maquettes sur mesure, dix emails. Suit
`BRIEF.md`, qui reste la référence en cas de doute.

## État au 25 août 2026

| Phase | État | Détail |
|---|---|---|
| 1 — Vérifier | **bloquée** | Aucune `GOOGLE_PLACES_API_KEY` disponible. `scripts/1-verifier.py` est écrit et prêt ; `data/cibles.json` contient une sélection provisoire dont 8 entrées portent `verifie: false`. |
| 2 — Images | faite | Aucune photo. Décision et traçabilité dans `assets/PHOTO-SOURCES.md`. |
| 3 — Maquettes | **faite** | Les dix, une session de design chacune. |
| 4 — Emails des prospects | partielle | 1 adresse sourcée (Le Guet-A-Pan), 9 à rechercher à la main. `scripts/2-contacts.py` valide et refuse toute adresse devinée. |
| 5 — Emails | écrits, **non envoyés** | Les dix messages + les dix relances sont dans `emails/`. `scripts/3-envoyer.py` tourne en dry-run et refuse d'armer l'envoi tant que les verrous ne sautent pas. |

**Rien n'est parti et rien ne peut partir en l'état.** Trois choses manquent, et
c'est voulu : la vérification Places, huit adresses email, et l'identité
d'expédition (`data/expediteur.json` est plein de `A_COMPLETER`).

## Ordre d'exécution

```bash
cd campagne-bordeaux

# 1. Vérifier l'absence de site — écrase data/cibles.json avec les vrais verdicts
export GOOGLE_PLACES_API_KEY=...
python3 scripts/1-verifier.py

# 2. Chercher les emails à la main, dans l'ordre du brief, puis :
python3 scripts/2-contacts.py --modele     # (déjà fait, ne pas écraser les acquis)
$EDITOR data/recherche-emails.json
python3 scripts/2-contacts.py

# 3. Remplir data/expediteur.json (SIREN, adresse, prénom, SPF/DKIM/DMARC "ok")

# 4. Relire les dix messages rendus
python3 scripts/3-envoyer.py               # dry-run, écrit emails/_rendu/
less emails/_rendu/*.txt

# 5. Armer, une fois les dix relus
BREVO_API_KEY=... python3 scripts/3-envoyer.py --envoyer

# 6. Six jours plus tard, la relance unique
BREVO_API_KEY=... python3 scripts/3-envoyer.py --relance --envoyer
```

## Les dix maquettes

Chacune part d'un fait tiré du JSON, pas d'un template décliné. Le test de
relecture du brief — *si cette page pouvait servir à un autre restaurant de la
liste, la refaire* — est appliqué en fin de chaque `DESIGN-NOTES.md`.

| Slug | Signature — ce dont on se souvient |
|---|---|
| `le-guet-a-pan` | Le plan du marché des Capucins, avec la distance jusqu'à chaque fournisseur |
| `chez-ludo` | L'heure réelle du visiteur et le cadran 22 h → 4 h : « la cuisine tourne encore 4 h 13 » |
| `chez-jean-mi` | Le prix comme image : `11 €` plus grand que l'enseigne, l'ardoise prix-à-gauche |
| `l-assiette-du-coin` | Deux boutons qui changent la semaine devant le visiteur — la démo de la mise à jour |
| `l-oustaou` | Le lexique landais, où chaque définition transporte une info pratique |
| `casa-gatti` | Le set de table, frise de chats sur les quatre bords |
| `le-calixte` | Le filtre végétarien qui recalcule le compteur « 8 plats sur 14 » |
| `la-mere-michel` | La flèche Saint-Michel graduée de 8 h à 23 h 30 |
| `toopita` | Le composeur de table : on coche des mezzés, la page dit pour combien de personnes |
| `dat-viet` | Le bol en coupe annotée, et « ce qui n'est pas dans le bol » (Nord vs Sud) |

Vingt polices différentes, dix palettes sans recoupement, aucune des trois
combinaisons interdites par le brief. Vérifié au rendu : aucun débordement
horizontal à 360 px, aucune erreur JavaScript, focus clavier visible,
`prefers-reduced-motion` respecté, zéro requête image.

Ouvrir une maquette : double-clic sur `maquettes/<slug>/index.html`.

## Points de vigilance

- **Le field mask du brief est celui de `places:searchText`.** L'endpoint Details
  (`GET /v1/places/{id}`) renvoie un seul place : le mask s'écrit sans le préfixe
  `places.`. `1-verifier.py` utilise la forme correcte, mêmes champs.
- **Un seul lien dans le corps, plus la désinscription en pied.** Les deux
  contraintes du brief sont incompatibles au pied de la lettre ; le lien de
  désinscription est une obligation légale, il vit dans le pied et n'est pas
  compté comme le « seul lien » du message. `controler_forme()` applique
  exactement cette lecture.
- **`paulbatsalle@yahoo.fr` est une adresse personnelle**, relevée sur Infobel.
  Confiance moyenne : c'est le fondateur, pas une boîte d'établissement.
- **Chez Ludo n'a pas d'email** et n'en aura probablement pas. Messenger sur
  `mangerlanuitabordeaux`, ou passage à 15 h. C'est le prospect avec le plus
  fort écart note/présence web de la liste : il vaut le déplacement.
- **Ne pas envoyer depuis Gmail par script.** `3-envoyer.py` refuse. Si le
  domaine n'est pas prêt, les dix partent à la main sur trois jours.
