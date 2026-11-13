# BILINGUAL — Chinese and English are separate systems

Chinese and English are **not** translations of one template. Each language
has its own data file, its own counts, its own slop list and its own genre
packs. A chapter written in one language must never be produced by translating
the other language's template.

## Language files

- `data/languages/zh.yaml` — Chinese defaults.
- `data/languages/en.yaml` — English defaults.
- `data/slop/zh.yaml`, `data/slop/en.yaml` — banned AI-flavour phrases per language.
- `data/genres/fanqie_*.yaml` — Chinese platform genre packs.
- `data/genres/royalroad_litrpg.yaml` — English platform genre pack.

The skill reads `data/languages/<LANG>.yaml` for every language-dependent
number. `SKILL.md` and the scripts never hard-code a language.

## The numbers that differ

| Item | zh | en |
|---|---|---|
| Chapter length (serial) | 2000–3000 characters | 1500–2500 words |
| Chapter length (probe/excerpt) | 800+ characters | 600+ words |
| Paragraph | short, often 1–3 sentences | short, often 1–3 sentences |
| Dialogue share | high (serial fiction reads on dialogue) | high |
| Hook position | end of chapter, one sentence | end of chapter, one sentence |
| Slop list | `data/slop/zh.yaml` | `data/slop/en.yaml` |

## What does NOT differ

The 5 desires, the chapter contract, the foreshadowing ledger, the knows
lists, the gates, the audit dimensions, the commit discipline. Those are the
kernel. Only the language data changes.

## Adding a language

1. Copy `data/languages/en.yaml` to `data/languages/<code>.yaml` and fill it
   in — do not translate the Chinese file word for word.
2. Add `data/slop/<code>.yaml` with that language's real AI-flavour patterns.
3. Add at least one genre pack for that language's primary platform.
4. Run the three check scripts against a 3-chapter sample in that language
   before claiming the language is supported.
