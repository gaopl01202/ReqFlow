#!/usr/bin/env python3
"""Restore only to a new, empty database and new storage directory."""

import argparse
import hashlib
import json
import subprocess
import tarfile
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("backup", type=Path)
parser.add_argument(
    "--database", required=True, help="New database name; existing databases are rejected"
)
parser.add_argument("--storage", required=True, type=Path)
args = parser.parse_args()
if args.storage.exists():
    raise SystemExit("Storage destination already exists; choose a new path")
manifest = json.loads((args.backup / "manifest.json").read_text())
for name in ["database.dump", "attachments.tar.gz"]:
    if hashlib.sha256((args.backup / name).read_bytes()).hexdigest() != manifest[name]:
        raise SystemExit("Backup checksum mismatch")
subprocess.run(["createdb", args.database], check=True)
subprocess.run(
    [
        "pg_restore",
        "--exit-on-error",
        "--no-owner",
        "--dbname",
        args.database,
        str(args.backup / "database.dump"),
    ],
    check=True,
)
args.storage.mkdir(parents=True)
with tarfile.open(args.backup / "attachments.tar.gz") as archive:
    archive.extractall(args.storage, filter="data")
print("Restore complete; attachment root:", args.storage / "attachments")
