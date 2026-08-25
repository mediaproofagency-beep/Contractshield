# DAT VIET CHARTRONS — notes de design

**Sujet.** Un vietnamien du Nord rue Notre-Dame, aux Chartrons, tenu par un
patron qui est en salle tous les services. La particularité n'est pas « asiatique »
ni même « vietnamien » : c'est **le Nord**. Le phở du Nord se sert sobre — pas de
pousses de soja, pas de basilic thaï, pas de sauce hoisin dans le bol. Ce qu'on
enlève est aussi identifiant que ce qu'on met.

**Palette.**
- `--anis #241813` — brun-noir de badiane, fond des blocs forts
- `--porcelaine #F2F3F0` — blanc froid de bol, fond de page
- `--bouillon #C08A2A` — l'ambre du bouillon, accent principal
- `--herbe #4E7A4B` — vert des herbes fraîches, second accent
- `--fumee #6E6A63` — texte secondaire

**Typographie.** *Be Vietnam Pro* en display, graisse 800 — une famille dessinée
pour le vietnamien, avec tous ses diacritiques correctement placés (`phở`,
`bún chả` s'écrivent juste). *Source Serif 4* en texte : une serif de lecture qui
donne au propos culinaire un ton de fiche, pas d'affiche.

**Layout.** La page est une planche anatomique. Le bol en coupe, annoté, occupe
le premier écran ; tout le reste développe ce qui est écrit dessus.

```
┌──────────────────────────────────────────┐
│ DAT VIET                 rue Notre-Dame  │
├──────────────────────────────────────────┤
│  UN BOUILLON. SIX HEURES.                │
│  Rien à rajouter dedans.                 │
│                                          │
│      bánh phở ──┐   ┌── bœuf saignant    │
│   coriandre ────┤ ▁▁▁ ├── oignon         │  ← coupe annotée
│                 └─▂▂▂─┘                  │
│      bouillon d'os, gingembre brûlé      │
├──────────────────────────────────────────┤
│  CE QUI N'EST PAS DANS LE BOL            │  ← Nord vs Sud
│  ✗ pousses de soja ✗ hoisin ✗ basilic    │
├──────────────────────────────────────────┤
│  LA CARTE — phở, bún chả, nem            │
├──────────────────────────────────────────┤
│  LE PATRON EST EN SALLE                  │
├──────────────────────────────────────────┤
│  VENIR — 133 rue Notre-Dame, Chartrons   │
└──────────────────────────────────────────┘
```

**Signature.** La coupe annotée, et surtout la section « ce qui n'est pas dans le
bol ». C'est un contenu qu'aucun template ne produit : il faut savoir ce qui
sépare Hanoï de Saïgon pour l'écrire, et c'est précisément ce que le patron
explique en salle depuis des années sans avoir jamais pu l'écrire nulle part.

**Relecture.** La planche anatomique du bol et la liste des absents ne
s'appliquent à aucun autre établissement de la campagne.
