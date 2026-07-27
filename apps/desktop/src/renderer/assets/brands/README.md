# Vendored brand marks

Real logo files for the three products Space names in its UI that
[Simple Icons](https://simpleicons.org) does not ship. Everything else comes
from the `simple-icons` package at build time (see `../../brand-icons.tsx`);
only these three are checked in, so the app never has to substitute a
look-alike glyph for a real product.

They are static logos — the files are downloaded once and committed, not
fetched at runtime. Re-download only if a vendor redraws its mark.

| File | Product | Source | License |
| --- | --- | --- | --- |
| `visual-studio-code.svg` | Visual Studio Code | [devicons/devicon](https://github.com/devicons/devicon) `icons/vscode/vscode-original.svg` | MIT |
| `openai.svg` | OpenAI (the Codex CLI's mark) | [lobehub/lobe-icons](https://github.com/lobehub/lobe-icons) `packages/static-svg/icons/openai.svg` | MIT |
| `volta.png` | Volta | [volta-cli](https://github.com/volta-cli) organization mark, downscaled to 128px | Volta's own mark, used to identify Volta |

Simple Icons dropped Visual Studio Code and OpenAI over trademark terms, and
has never carried Volta; Volta publishes no vector mark at all, which is why
its file is a PNG. Marks are used nominatively — to label the tool they belong
to. The artwork itself is unmodified; the only edit is on `openai.svg`, whose
`width`/`height` were `1em` (sized by the surrounding text in the set it came
from) and are now `24` to match its viewBox, so it scales predictably in an
`<img>`.
