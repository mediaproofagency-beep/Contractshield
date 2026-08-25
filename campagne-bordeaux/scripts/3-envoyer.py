#!/usr/bin/env python3
"""
Phase 5 — Rendu et envoi des emails de prospection.

Par defaut le script ne fait qu'ecrire les messages rendus dans emails/_rendu/.
L'envoi reel demande --envoyer, et se heurte a une serie de verrous :

  1. le prospect doit etre verifie sans site (cibles.json, verifie=true)
  2. il doit avoir un email source (contacts.json)
  3. il ne doit pas etre dans data/blocklist.json
  4. data/expediteur.json ne doit plus contenir de A_COMPLETER
  5. le domaine d'envoi ne doit pas etre gmail.com
  6. le plafond quotidien (5 a 8) ne doit pas etre atteint
  7. le message doit passer les controles de forme du brief

Usage :
    python3 scripts/3-envoyer.py                  # dry-run, tous les prospects
    python3 scripts/3-envoyer.py --slug chez-ludo # un seul
    python3 scripts/3-envoyer.py --relance        # rendu des relances J+6
    BREVO_API_KEY=... python3 scripts/3-envoyer.py --envoyer
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
D = RACINE / "data"
EMAILS = RACINE / "emails"
RENDU = EMAILS / "_rendu"

BREVO = "https://api.brevo.com/v3/smtp/email"
DELAI_RELANCE = 6           # jours
PLAFOND_ABSOLU = 8          # jamais plus, domaine neuf
MOTS_MAX = 120


def charger(nom: str) -> dict:
    return json.loads((D / nom).read_text(encoding="utf-8"))


def ecrire(nom: str, donnees: dict) -> None:
    (D / nom).write_text(json.dumps(donnees, ensure_ascii=False, indent=2),
                         encoding="utf-8")


# ---------------------------------------------------------------- rendu

def separer(brut: str) -> tuple[str, str]:
    """Retire les lignes de commentaire, renvoie (objet, corps+pied)."""
    lignes = [l for l in brut.splitlines() if not l.startswith("#")]
    texte = "\n".join(lignes).strip("\n")
    objet = ""
    if texte.startswith("OBJET:"):
        objet, _, texte = texte.partition("\n")
        objet = objet[len("OBJET:"):].strip()
    return objet, texte.strip("\n")


def remplir(texte: str, valeurs: dict) -> str:
    def rempl(m):
        cle = m.group(1)
        if cle not in valeurs:
            raise KeyError(f"placeholder inconnu : {{{{{cle}}}}}")
        return str(valeurs[cle])
    return re.sub(r"\{\{([A-Z_]+)\}\}", rempl, texte)


def mots(texte: str) -> int:
    return len(re.findall(r"\S+", texte))


def controler_forme(objet: str, corps: str, pied: str) -> list[str]:
    """Controles du brief. Le pied legal est exclu du comptage de mots et
    porte le seul second lien tolere (la desinscription, obligatoire)."""
    p = []
    if "!" in objet:
        p.append("objet : point d'exclamation interdit")
    for mot in re.findall(r"[^\W\d_]{3,}", objet, re.UNICODE):
        if mot.isupper():
            p.append(f"objet : mot en majuscules « {mot} »")
    n = mots(corps)
    if n >= MOTS_MAX:
        p.append(f"corps : {n} mots, plafond {MOTS_MAX}")
    liens = re.findall(r"https?://\S+", corps)
    if len(liens) != 1:
        p.append(f"corps : {len(liens)} lien(s), il en faut exactement un")
    if re.search(r"<img|cid:|\.(png|jpe?g|gif)\b", corps, re.I):
        p.append("corps : image detectee (declenche les filtres)")
    for obligatoire, libelle in (
            ("MediaProof Agency", "identification de l'expediteur"),
            ("SIREN", "numero SIREN"),
            ("Google Business Profile", "origine des donnees"),
            ("Ne plus recevoir", "lien de desinscription")):
        if obligatoire not in pied:
            p.append(f"pied : {libelle} manquant")
    if not re.search(r"https?://", pied):
        p.append("pied : lien de desinscription non cliquable")
    return p


# ---------------------------------------------------------------- verrous

def verrous_globaux(exp: dict, envoi_reel: bool) -> list[str]:
    p = []
    manquants = [k for k, v in exp.items()
                 if not k.startswith("_") and isinstance(v, str)
                 and "A_COMPLETER" in v]
    if manquants:
        p.append("expediteur.json incomplet : " + ", ".join(manquants))
    if exp.get("expediteur_email", "").lower().endswith("@gmail.com"):
        p.append("envoi automatique depuis gmail.com refuse. Si le domaine "
                 "n'est pas pret, envoyer les dix a la main sur trois jours.")
    if not 1 <= int(exp.get("cap_quotidien", 0)) <= PLAFOND_ABSOLU:
        p.append(f"cap_quotidien doit valoir entre 1 et {PLAFOND_ABSOLU}")
    auth = exp.get("authentification", {})
    if envoi_reel and any(auth.get(k) != "ok" for k in ("spf", "dkim", "dmarc")):
        p.append("SPF/DKIM/DMARC non confirmes (mettre \"ok\" une fois verifies)")
    if envoi_reel and not os.environ.get(
            exp.get("transport", {}).get("cle_api_env", "BREVO_API_KEY")):
        p.append("cle API Brevo absente de l'environnement")
    return p


def bloque(email: str, blocklist: dict) -> bool:
    e = email.lower().strip()
    if e in {a.lower() for a in blocklist.get("adresses", [])
             if isinstance(a, str)}:
        return True
    if any(isinstance(a, dict) and a.get("email", "").lower() == e
           for a in blocklist.get("adresses", [])):
        return True
    domaine = e.rsplit("@", 1)[-1]
    return domaine in {d.lower() for d in blocklist.get("domaines", [])}


# ---------------------------------------------------------------- envoi

def envoyer_brevo(cle: str, exp: dict, dest: str, nom_dest: str,
                  objet: str, texte: str) -> str:
    charge = json.dumps({
        "sender": {"email": exp["expediteur_email"], "name": exp["expediteur_nom"]},
        "replyTo": {"email": exp.get("reply_to") or exp["expediteur_email"]},
        "to": [{"email": dest, "name": nom_dest}],
        "subject": objet,
        "textContent": texte,
    }).encode("utf-8")
    requete = urllib.request.Request(BREVO, data=charge, headers={
        "api-key": cle, "content-type": "application/json", "accept": "application/json"})
    with urllib.request.urlopen(requete, timeout=30) as r:
        return json.load(r).get("messageId", "envoye")


# ---------------------------------------------------------------- main

def main() -> int:
    a = argparse.ArgumentParser()
    a.add_argument("--envoyer", action="store_true",
                   help="armer l'envoi reel (defaut : dry-run)")
    a.add_argument("--relance", action="store_true",
                   help="traiter les relances J+6 au lieu du premier message")
    a.add_argument("--slug", help="ne traiter qu'un prospect")
    args = a.parse_args()

    exp = charger("expediteur.json")
    cibles = {c["slug"]: c for c in charger("cibles.json")["retenus"]}
    contacts = {c["slug"]: c for c in charger("contacts.json")["contacts"]}
    blocklist = charger("blocklist.json")
    campagne = charger("campagne.json")
    suivi = {e["slug"]: e for e in campagne["envois"]}

    globaux = verrous_globaux(exp, args.envoyer)
    if globaux and args.envoyer:
        print("Envoi refuse :", file=sys.stderr)
        for g in globaux:
            print("  - " + g, file=sys.stderr)
        return 1
    for g in globaux:
        print(f"[config] {g}")

    RENDU.mkdir(parents=True, exist_ok=True)
    aujourdhui = date.today().isoformat()
    deja_aujourdhui = sum(
        1 for e in campagne["envois"]
        if (e.get("envoye_le") or "").startswith(aujourdhui)
        or (e.get("relance_le") or "").startswith(aujourdhui))
    cap = int(exp.get("cap_quotidien", 5))

    envoyes = 0
    for slug, cible in cibles.items():
        if args.slug and slug != args.slug:
            continue

        suffixe = "-relance" if args.relance else ""
        fichier = EMAILS / f"{slug}{suffixe}.txt"
        if not fichier.exists():
            print(f"{slug:<20} · pas de fichier {fichier.name}")
            continue

        contact = contacts.get(slug)
        etat = suivi.get(slug, {})
        raisons = []

        if cible.get("verifie") is not True:
            raisons.append("non verifie (lancer 1-verifier.py)")
        if cible.get("verdict") not in ("CIBLE", "CIBLE_FAIBLE"):
            raisons.append(f"verdict {cible.get('verdict')!r}")
        if contact is None:
            raisons.append("aucun email (voir contacts-alternatifs.json)")
        elif bloque(contact["email"], blocklist):
            raisons.append("adresse en blocklist")
        if args.relance:
            if not etat.get("envoye_le"):
                raisons.append("premier message pas encore envoye")
            elif etat.get("relance_le"):
                raisons.append("deja relance (une seule relance)")
            else:
                envoi = datetime.fromisoformat(etat["envoye_le"][:10]).date()
                if date.today() < envoi + timedelta(days=DELAI_RELANCE):
                    raisons.append(f"relance prevue le "
                                   f"{envoi + timedelta(days=DELAI_RELANCE)}")
            if etat.get("reponse"):
                raisons.append("a repondu, on n'insiste pas")
        elif etat.get("envoye_le"):
            raisons.append(f"deja envoye le {etat['envoye_le']}")

        valeurs = {
            "URL_MAQUETTE": f"{exp['base_maquettes'].rstrip('/')}/{slug}/",
            "URL_DESINSCRIPTION": f"{exp['base_desinscription'].rstrip('/')}"
                                  f"?c={slug}",
            "EXPEDITEUR_PRENOM": exp.get("EXPEDITEUR_PRENOM", ""),
            "ADRESSE_AGENCE": exp.get("ADRESSE_AGENCE", ""),
            "SIREN": exp.get("SIREN", ""),
        }
        objet, texte = separer(fichier.read_text(encoding="utf-8"))
        try:
            objet, texte = remplir(objet, valeurs), remplir(texte, valeurs)
        except KeyError as err:
            print(f"{slug:<20} · {err}")
            continue

        corps, _, pied = texte.rpartition("\n--\n")
        if not corps:
            corps, pied = texte, ""
        forme = controler_forme(objet, corps, pied)
        raisons += [f"forme : {f}" for f in forme]

        (RENDU / f"{slug}{suffixe}.txt").write_text(
            f"À      : {contact['email'] if contact else '— aucun email —'}\n"
            f"De     : {exp.get('expediteur_nom')} <{exp.get('expediteur_email')}>\n"
            f"Objet  : {objet}\n\n{corps}\n--\n{pied}\n",
            encoding="utf-8")

        if raisons:
            print(f"{slug:<20} · retenu : " + " ; ".join(raisons))
            continue

        if not args.envoyer:
            print(f"{slug:<20} · PRET (dry-run) -> {contact['email']}")
            continue

        if deja_aujourdhui + envoyes >= cap:
            print(f"{slug:<20} · plafond quotidien atteint ({cap}), demain")
            continue

        try:
            ident = envoyer_brevo(
                os.environ[exp["transport"]["cle_api_env"]], exp,
                contact["email"], cible["nom"], objet, f"{corps}\n--\n{pied}")
        except urllib.error.HTTPError as err:
            print(f"{slug:<20} · ECHEC {err.code} {err.read()[:200]!r}",
                  file=sys.stderr)
            continue

        horodatage = datetime.now().isoformat(timespec="seconds")
        if args.relance:
            etat["relance_le"], etat["statut"] = horodatage, "relance"
        else:
            etat["envoye_le"], etat["statut"] = horodatage, "envoye"
        etat["message_id"] = ident
        ecrire("campagne.json", campagne)
        envoyes += 1
        print(f"{slug:<20} · envoye a {contact['email']} ({ident})")
        time.sleep(2)

    print(f"\nRendus dans {RENDU.relative_to(RACINE)}/ — "
          f"{'envoi reel' if args.envoyer else 'DRY-RUN, rien n a ete envoye'}.")
    if not args.envoyer:
        print("Relire les dix messages avant d'armer --envoyer.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
