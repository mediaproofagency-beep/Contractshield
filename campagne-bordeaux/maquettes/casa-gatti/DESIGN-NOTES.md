# CASA GATTI TRATTORIA — notes de design

**Sujet.** Une petite trattoria de la Bastide, cours Le Rouzic, quatre-vingt-sept
avis à 4,9. Burrata, pesto, amatriciana, ragù, tartufo — et des pâtes à la
pistache qui reviennent dans les avis. Le nom veut dire « la maison des chats ».

**Palette.**
- `--lait #FBF8F9` — blanc très légèrement rosé, fond de page
- `--aubergine #3B2340` — la couleur du texte et des grands blocs
- `--pistache #7FA65A` — l'accent, pris sur le plat signature
- `--encre #241726` — titres
- `--cendre #8C8090` — texte secondaire

Ni rouge ni drapeau : le vert n'est pas « italien », c'est la pistache. Et le
fond n'est pas un crème — c'est un blanc froid tirant sur le rose.

**Typographie.** *Prata* en display, une didone à fort contraste, employée en
capitales espacées pour l'enseigne. *Work Sans* en texte. Le contraste
display/texte est net, mais sans la serif de labeur qui traîne partout.

**Layout.** La carte est un **set de table**. Un rectangle bordé, imprimé, posé
au milieu de la page — exactement l'objet en papier qu'on trouve sous l'assiette
dans une trattoria, avec sa frise en bordure. Les chats sont dans la marge.

```
┌──────────────────────────────────────────┐
│  CASA GATTI          cours Le Rouzic     │
│                                          │
│      🐈 (trait)      « la maison         │
│                        des chats »       │
├──────────────────────────────────────────┤
│  ╔══════ frise de chats ══════╗          │
│  ║  ANTIPASTI      PRIMI      ║          │  ← le set de table
│  ║  ...            ...        ║          │
│  ║  ─── il piatto: pistache ──║          │
│  ║  DOLCI          VINI       ║          │
│  ╚═════════════════════════════╝          │
├──────────────────────────────────────────┤
│  LA PISTACHE — pourquoi ce plat-là       │
├──────────────────────────────────────────┤
│  VENIR — Bastide, 53 cours Le Rouzic     │
└──────────────────────────────────────────┘
```

**Signature.** Le set de table, avec sa frise de chats dessinés au trait qui
court sur les quatre bords. C'est l'objet de la maison, et le nom devient un
motif graphique au lieu d'un logo.

**Relecture.** Le motif tient au nom de l'établissement : aucune autre maquette
de la liste ne peut reprendre ni la frise ni le set.
