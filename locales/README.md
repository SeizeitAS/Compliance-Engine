# Locales

All source code, comments, identifiers and documentation in this repository are written in
**English**. User-facing text lives only in the files in this folder.

- `en.json` is the source of truth. Every key must exist here.
- Add a language by copying `en.json` to `<BCP-47 tag>.json` (for example `de.json`, `nb.json`,
  `pt-BR.json`) and translating the values. Keep `{placeholders}` unchanged.
- Plurals use CLDR categories as key suffixes: `key.one`, `key.other` (and `zero`, `two`, `few`,
  `many` where the language needs them). `key.other` is required.
- A missing key falls back along `nb-NO` -> `nb` -> `en` -> the key itself.
- `npm test` fails if a locale has keys that `en.json` lacks, or placeholders that differ.
  Missing translations are allowed (they fall back to English) but are reported.
- Legal terms with a fixed official translation (for example from MiCA or Hvitvaskingsloven)
  should use the official wording and cite the source in the pull request.
