# TOOPITA Saint Michel — notes de design

**Sujet.** Une adresse libanaise récente, place Meynard, 4,9 sur Google au bout
de cent trente avis. Shish tawook, shawarma, falafel, taboulé, vins libanais, et
une terrasse sur la place. Le vrai sujet n'est pas un plat : c'est la **table**
— on ne commande pas un plat chacun, on compose un ensemble pour tout le monde.

**Palette.**
- `--sumac #A32D28` — rouge sombre du sumac, couleur principale
- `--zaatar #6E7A38` — vert-kaki du thym-sésame, second accent
- `--craie #F5F3ED` — fond clair très légèrement chaud
- `--nuit #1F2430` — bleu-noir du texte
- `--sable #D9D4C7` — filets, séparations

**Typographie.** *Rubik* en display, graisse 800 : des formes courtes et
arrondies, dessinées à l'origine pour cohabiter avec l'arabe. *IBM Plex Sans* en
texte, technique et neutre, pour laisser la couleur travailler.

**Layout.** La page est un plateau. Une mosaïque géométrique en bandeau, puis
une grille de mezzés qu'on coche, et un récapitulatif qui se remplit.

```
┌──────────────────────────────────────────┐
│ TOOPITA                    place Meynard │
│ ▨▧▨▧▨▧▨▧▨▧▨▧ (mosaïque, bandeau sumac)   │
│                                          │
│  ON NE COMMANDE PAS UN PLAT CHACUN.      │
│  On compose une table.                   │
├──────────────────────────────────────────┤
│  ┌────┬────┬────┐   ╔═══════════════╗    │
│  │mezzé│mezzé│... │  ║ VOTRE TABLE   ║   │ ← récap vivant
│  └────┴────┴────┘   ║ 4 mezzés · 3 p ║   │
│   (on coche)        ║ ~ 38 €         ║   │
│                     ╚═══════════════╝    │
├──────────────────────────────────────────┤
│  LA BROCHE ET LA BRAISE (shawarma…)      │
├──────────────────────────────────────────┤
│  LES VINS LIBANAIS — Bekaa               │
├──────────────────────────────────────────┤
│  LA TERRASSE — place Meynard             │
└──────────────────────────────────────────┘
```

**Signature.** Le composeur de table. On coche des mezzés, le panneau annonce
combien de personnes ça nourrit et à quel prix. C'est l'inverse d'un menu PDF :
ça répond à la seule question que se pose un groupe de quatre devant une carte
libanaise — « on prend combien de trucs ? ».

**Relecture.** Le composeur suppose une cuisine de partage à petites assiettes.
Il n'a aucun sens sur une crêperie, un comptoir à huîtres ou un bistrot de nuit.
