# Fonts

This folder holds the four faces the product is set in, each as a static TTF file and a WOFF2 file.
The interface uses them on iOS, Android and the web, and every card canvas is drawn with them, on
phones and by the server renderer.

## The faces

| Face                    | Instance                                    | SHA-256 of the TTF                                                 |
| ----------------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| `SpecialGothic-Regular` | Special Gothic, weight 400, width 100       | `5f778c05b05d2fa4ea23b6e90813fb8696da464b96ae6c6a0ad1bb91b300c517` |
| `SpecialGothic-Medium`  | Special Gothic, weight 500, width 100       | `7947c5aaa66aed1d9a8fbabbbb4bd0989bdb88ddbca20f6a0ed7b6c64039ad5f` |
| `SpecialGothic-Bold`    | Special Gothic, weight 700, width 100       | `d0bd7ff2c3ff28c95a4536c1f9e9b16ffe32b3a34750101c999ee0ed9ca721bf` |
| `ChivoMono-Medium`      | Chivo Mono, weight 500, no `liga` or `dlig` | `b44520d1438626dee18115faab0df6ab0ea75408fb227f135e25a7ee73677dda` |

`SHA256SUMS` lists the SHA-256 of all eight files and is the check: `shasum -a 256 -c SHA256SUMS`
in this folder prints `OK` for each of them. The unit tests run the same check, and the
renderer's `assertFontFiles` checks the four TTF files it loads. A changed byte changes every
rendered card, so the files are never rebuilt or edited in place.

## How they were made

Each face was cut from its family's variable font with fontTools: every weight was instanced from
the variable source at the values above, renamed so that the file name is also its PostScript name,
and subset to the characters the product draws. The mono face had its `liga` and `dlig` features
removed. Then each glyph's overlapping contours were merged into one outline with fontTools'
`removeOverlaps` (on skia-pathops), which also decomposes an accented letter whose parts overlap,
and the overlap flag was cleared from every glyph, so each glyph fills the same under the nonzero
and the even-odd rule. The name table, metrics, glyph set and features are unchanged, and the
faces stay unhinted. Each WOFF2 file was written from its merged TTF. The build writes no
timestamps, so it gives byte-identical files on every run.

The sources were these variable files:

| Family         | Upstream repository                                | Version | SHA-256 of the variable file                                       |
| -------------- | -------------------------------------------------- | ------- | ------------------------------------------------------------------ |
| Special Gothic | https://github.com/AlistairMcCready/Special-Gothic | 1.011   | `2bbf8bcb6c02cacbdcdc4b6db7ae450b85447bfe5a0ba4ae46c9f69182b5c414` |
| Chivo Mono     | https://github.com/Omnibus-Type/Chivo              | 1.008   | `725256f30b7b1b25dd001a96ff8d4a23773197bb886cd847a97ff8eabc9c1d9d` |

## Licence

Both families are licensed under the SIL Open Font License 1.1, with no Reserved Font Name, so the
instanced and subset files keep their names. The licence texts are `OFL-SpecialGothic.txt` and
`OFL-ChivoMono.txt` in this folder.
