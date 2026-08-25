# La Mère Michel — notes de design

**Sujet.** Une crêperie-galetterie place Meynard, en face de la flèche
Saint-Michel, ouverte de 8 h à 23 h 30, sept jours sur sept. Ce n'est pas un
restaurant avec deux services : c'est une adresse ouverte en continu, du café du
matin à la crêpe de fin de soirée.

**Palette.**
- `--ardoise #2B3A5C` — bleu d'ardoise sombre, couleur dominante
- `--jour #F7F9FC` — blanc bleuté, fond de page (aucun crème)
- `--caramel #A9701F` — l'ambre du caramel beurre salé, accent unique
- `--pierre #7C889E` — gris-bleu du texte secondaire
- `--sarrasin #4A3E30` — brun sombre, réservé au bloc galettes

Pas de bleu-blanc-noir breton en aplat : le bleu vient de l'ardoise du toit d'en
face, le brun de la farine de sarrasin.

**Typographie.** *Fraunces* en display — une serif un peu bancale, chaleureuse,
qui va à une maison de quartier ouverte quinze heures par jour. *Nunito Sans* en
texte, ronde et très lisible en petit corps.

**Layout.** La flèche Saint-Michel dessinée en vertical sert de colonne à la
journée. Elle est graduée de 8 h à 23 h 30, et les quatre moments de la maison y
sont accrochés.

```
┌──────────────────────────────────────────┐
│ LA MÈRE MICHEL          place Meynard    │
│                                          │
│   ▲       OUVERT DE 8 H À 23 H 30        │
│  ╱ ╲      tous les jours, sans coupure   │
│ ┃23h30┃                                  │
│ ┃     ┃── 20h  LE DÎNER   galette+cidre  │  ← la flèche graduée
│ ┃     ┃── 16h  LE GOÛTER  caramel b.s.   │
│ ┃     ┃── 12h  LE DÉJEUNER trois fromages│
│ ┃ 8h  ┃── 8h   LE CAFÉ    et la terrasse │
├──────────────────────────────────────────┤
│  LES GALETTES (bloc sarrasin foncé)      │
├──────────────────────────────────────────┤
│  LA TERRASSE — ce qu'on regarde en face  │
└──────────────────────────────────────────┘
```

**Signature.** La flèche graduée. Le monument qu'on a sous les yeux depuis la
terrasse devient l'échelle horaire de la page — et l'amplitude d'ouverture, qui
est le vrai argument commercial de la maison, se lit d'un seul coup d'œil au
lieu d'être une ligne de texte en bas de page.

**Relecture.** La flèche est à cinquante mètres de la table : aucune autre
adresse de la liste ne peut s'en servir.
