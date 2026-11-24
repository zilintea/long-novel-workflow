#!/usr/bin/env python3
"""Snapshot a user submission as a named version (v2.3.0, P1).
Stdlib only. Usage:
  python3 scripts/snapshot_submission.py <book_dir> <version> [--force]

Copies the current user_submission/ files (user_brief.md,
user_outline.yaml, user_characters.yaml, user_foreshadowing.yaml —
whichever exist) into user_submission/versions/<version>/, untouched.
The live files stay where they are; the snapshot is the record of what
the author actually submitted at that version.

Run this BEFORE the author edits the submission, so outline_diff.py can
later compare the snapshot against the new live files. Refuses to
overwrite an existing version unless --force is given. Exit 0 on success.
"""
import os
import shutil
import sys

FILES = ("user_brief.md", "user_outline.yaml", "user_characters.yaml",
         "user_foreshadowing.yaml")


def main():
    args = sys.argv[1:]
    force = "--force" in args
    args = [a for a in args if a != "--force"]
    if len(args) != 2:
        print("usage: snapshot_submission.py <book_dir> <version> [--force]",
              file=sys.stderr)
        sys.exit(2)
    book_dir, version = args
    src_dir = os.path.join(book_dir, "user_submission")
    if not os.path.isdir(src_dir):
        print(f"FAIL: no user_submission/ in {book_dir}")
        sys.exit(1)
    dest_dir = os.path.join(src_dir, "versions", version)
    if os.path.exists(dest_dir) and not force:
        print(f"FAIL: versions/{version} already exists — use --force to "
              "re-snapshot, or pick a new version name")
        sys.exit(1)
    os.makedirs(dest_dir, exist_ok=True)
    copied = []
    for name in FILES:
        src = os.path.join(src_dir, name)
        if os.path.exists(src):
            shutil.copy2(src, os.path.join(dest_dir, name))
            copied.append(name)
    if not copied:
        print(f"FAIL: no submission files found in {src_dir}")
        sys.exit(1)
    for name in copied:
        print(f"snapshot: user_submission/versions/{version}/{name}")
    print(f"snapshot_submission: OK (version {version}, {len(copied)} files)")
    sys.exit(0)


if __name__ == "__main__":
    main()
