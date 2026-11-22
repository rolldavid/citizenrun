# Fonts

This folder holds the four faces the product is set in, each as a static TTF file and a WOFF2 file.
The interface uses them on iOS, Android and the web, and every card canvas is drawn with them, on
phones and by the server renderer.

## The faces

| Face                    | Instance                                    | SHA-256 of the TTF                                                 |
| ----------------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| `SpecialGothic-Regular` | Special Gothic, weight 400, width 100       | `85e239f2a3966c102b8ce8e89098a0a4bff5ba57c7a86d70fbaaaa4da15e1001` |
| `SpecialGothic-Medium`  | Special Gothic, weight 500, width 100       | `aeeb0bab12c2a41b92f48954a61c3041f1a91c99cfe612c1387372f3c6a2f0fb` |
| `SpecialGothic-Bold`    | Special Gothic, weight 700, width 100       | `7a1dd1b2ade1a8a9db0d02a3cbd6a181afeb5cba66ac8d23e9e862b99e77d859` |
| `ChivoMono-Medium`      | Chivo Mono, weight 500, no `liga` or `dlig` | `eb4d47664fc11f9bd8051d7f3e60c6daac3bd747a396755caac2b7564c5e56e7` |

`SHA256SUMS` lists the SHA-256 of all eight files and is the check: `shasum -a 256 -c SHA256SUMS`
in this folder prints `OK` for each of them. The unit tests run the same check, and the
renderer's `assertFontFiles` checks the four TTF files it loads. A changed byte changes every
rendered card, so the files are never rebuilt or edited in place.

## How they were made

Each face was cut from its family's variable font with fontTools: every weight was instanced from
the variable source at the values above, renamed so that the file name is also its PostScript name,
and subset to the characters the product draws. The mono face had its `liga` and `dlig` features
removed. The build writes no timestamps, so it gives byte-identical files on every run.

The sources were these variable files:

| Family         | Upstream repository                                | Version | SHA-256 of the variable file                                       |
| -------------- | -------------------------------------------------- | ------- | ------------------------------------------------------------------ |
| Special Gothic | https://github.com/AlistairMcCready/Special-Gothic | 1.011   | `2bbf8bcb6c02cacbdcdc4b6db7ae450b85447bfe5a0ba4ae46c9f69182b5c414` |
| Chivo Mono     | https://github.com/Omnibus-Type/Chivo              | 1.008   | `725256f30b7b1b25dd001a96ff8d4a23773197bb886cd847a97ff8eabc9c1d9d` |

## Licence

Both families are licensed under the SIL Open Font License 1.1, with no Reserved Font Name, so the
instanced and subset files keep their names. The licence texts are `OFL-SpecialGothic.txt` and
`OFL-ChivoMono.txt` in this folder.
