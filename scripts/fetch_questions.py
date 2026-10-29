#!/usr/bin/env python3
"""Récupère toutes les questions de l'API dans data/questions.json.

L'API n'envoie pas d'en-têtes CORS, donc le site ne peut pas l'appeler
depuis le navigateur : on fait un instantané à la place (en local ou dans
le workflow GitHub Pages).
"""

import json
import urllib.request
from pathlib import Path

API = "https://mcq-api.paul-farault.workers.dev/questions?page=1&limit=100"
DATA = Path(__file__).resolve().parent.parent / "site" / "data"


def fetch_all():
    """Suit les liens `next` pour récupérer toutes les pages."""
    items, url = [], API
    while url:
        req = urllib.request.Request(url, headers={"User-Agent": "mcq-viewer"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            page = json.load(resp)
        items.extend(page["items"])
        url = page["links"].get("next")
    return items


if __name__ == "__main__":
    items = fetch_all()
    (DATA / "questions.json").write_text(json.dumps(items, ensure_ascii=False, indent=1) + "\n")

    answers = json.loads((DATA / "answers.json").read_text())
    missing = [q for q in items if str(q["id"]) not in answers]
    print(f"{len(items)} questions, {len(items) - len(missing)} corrigées")
    for q in missing:
        print(f"  sans corrigé : #{q['id']} {q['question'][:70]!r}")
