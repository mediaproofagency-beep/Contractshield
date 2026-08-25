# LE CALIXTE — notes de design

**Sujet.** Un bistrot de quartier rue Bonnefin, à la Bastide, dont l'équipe et la
carte ont été renouvelées. Carpaccio de veau à l'abricot, poireaux grillés à
l'orange, falafels : la moitié de la carte se mange sans viande, et ce ne sont
pas des garnitures déguisées en plats.

**Palette.**
- `--rhubarbe #B33A5B` — rose-rouge végétal, couleur principale
- `--olive #2F3524` — vert très sombre, texte et blocs
- `--craie #F4F5F1` — gris-blanc froid, fond (aucun crème)
- `--abricot #DE8B3B` — accent secondaire, réservé aux plats qui le portent
- `--fumee #6E7364` — texte secondaire

Le rose de rhubarbe évite le vert-sur-vert attendu dès qu'on parle de cuisine
végétale, et donne au bistrot une couleur qui n'est celle de personne d'autre
dans la liste.

**Typographie.** *Syne* en display — une grotesque contemporaine, un peu
tendue, qui dit « la carte a changé ». *Manrope* en texte, plus calme.

**Layout.** Une carte filtrable, avec le compteur en tête.

```
┌──────────────────────────────────────────┐
│ LE CALIXTE                rue Bonnefin   │
│                                          │
│  8 PLATS SUR 14                          │
│  se mangent sans viande.                 │  ← compteur réel, calculé
│  Et ce ne sont pas des garnitures.        │
├──────────────────────────────────────────┤
│ [ tout ] [ végétarien ] [ végétalien ]   │  ← barre collante
│  ┌────────┬────────┐                     │
│  │ plat   │ plat   │  cartes avec        │
│  │ ●végé  │        │  pastilles          │
│  └────────┴────────┘                     │
├──────────────────────────────────────────┤
│  LA CARTE CHANGE — équipe renouvelée     │
├──────────────────────────────────────────┤
│  VENIR — 64 rue Bonnefin, Bastide        │
└──────────────────────────────────────────┘
```

**Signature.** Le filtre. On clique « végétarien », la carte se réduit, et le
compteur en haut se recalcule devant le visiteur. C'est la preuve, pas la
promesse — et c'est utile au quotidien : la moitié des tables ont quelqu'un qui
cherche cette information avant de choisir le restaurant.

**Relecture.** Le filtre n'a de sens que pour une maison dont l'offre végétale
est un argument. Sur les neuf autres, il serait décoratif.
