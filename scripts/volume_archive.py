"""Stream private attachment volume archives for portable Docker backups."""

import os
import sys
import tarfile
from pathlib import Path


def pack(root: Path) -> None:
    root = root.resolve(strict=True)
    with tarfile.open(fileobj=sys.stdout.buffer, mode="w|gz") as archive:
        for current, dirs, files in os.walk(root, followlinks=False):
            current_path = Path(current)
            for name in sorted(dirs + files):
                path = current_path / name
                archive.add(path, arcname=path.relative_to(root), recursive=False)


def unpack(root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=sys.stdin.buffer, mode="r|gz") as archive:
        archive.extractall(root, filter="data")


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] not in {"pack", "unpack"}:
        raise SystemExit("usage: volume_archive.py pack|unpack DIRECTORY")
    directory = Path(sys.argv[2])
    if sys.argv[1] == "pack":
        pack(directory)
    else:
        unpack(directory)


if __name__ == "__main__":
    main()
