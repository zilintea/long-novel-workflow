# Sample Book — 《回声》 (original sample project)

A complete small **original sample** proving the directory contract works
end to end. It is not a real serial and not a pilot book: 3 chapters only,
each a probe-length excerpt (800–2000 characters, below the 2000–3000 serial
target — the checker warns about this, and passes). The pilot book's title
and character names are decided after the market scan; this sample's
characters are invented for the fixture only.

- Formula: rebirth-revenge + identity-suspense + strong-relationship.
- Language: zh. Platform target: Fanqie.
- Characters: 沈昭 (hero), 陆明远 (antagonist), 顾言舟 (ally).
- Threads: F01 (the locked drawer), F02 (the unsigned letter), F03 (the
  photograph with a stranger's face).

Run the checks from the repo root:

```bash
python3 scripts/check_chapter.py examples/sample-book
python3 scripts/check_continuity.py examples/sample-book
python3 scripts/check_hooks.py examples/sample-book
```
