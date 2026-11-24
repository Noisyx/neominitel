# Third-Party Assets, Fonts, and Licences

## Project Licence
NeoMinitel is released under the **MIT License** (see [LICENSE](../LICENSE)).

## 8×10 Videotex Bitmap Font (`src/videotex/font.ts`)
- **Origin:** Original pixel artwork drawn specifically for the NeoMinitel project (2026), inspired by the 8×10 character matrix proportions of 1980s Videotex CRT character generators (such as the Thomson EF9345) without copying any proprietary ROM dump.
- **Coverage:** Printable G0 ASCII (`0x20`–`0x7F`), the 12 supported G2 French accented characters (`à`, `â`, `ç`, `è`, `é`, `ê`, `ë`, `î`, `ï`, `ô`, `ù`, `û`), and the hatched error cell glyph.
- **Licence:** **MIT License** (same as the repository; copyright 2026 NeoMinitel contributors).

## Terminal Shell Illustration (`src/ui/terminal/MinitelShell.tsx`)
- **Origin:** Original SVG illustration drawn for NeoMinitel, inspired by early 1980s French desktop videotex terminals. Contains **no** Orange, France Télécom, PTT, or Telic-Alcatel logos or trademarks.
- **Licence:** **MIT License** (copyright 2026 NeoMinitel contributors).

## Reference Recordings (`tests/fixtures/`)
No external audio recordings are bundled yet. Any reference recording added for `[STRETCH]` interoperability testing (modem task 16) must have its source and open licence recorded here before commit.
