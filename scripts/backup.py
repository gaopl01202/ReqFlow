#!/usr/bin/env python3
"""Maintenance-mode database + private attachment backup with integrity manifest."""

import argparse
import hashlib
import json
import os
import subprocess
import tarfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("destination", type=Path)
parser.add_argument("--storage", type=Path, default=Path(".local/attachments"))
parser.add_argument("--maintenance-confirmed", action="store_true", required=True)
args = parser.parse_args()
args.destination.mkdir(parents=True, exist_ok=False)
os.chmod(args.destination, 0o700)
subprocess.run(
    ["pg_dump", "--format=custom", "--file", str(args.destination / "database.dump")], check=True
)
with tarfile.open(args.destination / "attachments.tar.gz", "w:gz") as archive:
    if args.storage.exists():
        archive.add(args.storage, arcname="attachments")
manifest = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in args.destination.iterdir()}
(args.destination / "manifest.json").write_text(json.dumps(manifest, indent=2))
print("Backup complete:", args.destination)
