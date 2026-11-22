# @citizenrun/cards

The generated graphics: card canvases and their drawings, the fonts every canvas is set in, and the
renderer that turns a canvas into a PNG on the server. The app draws the same canvases on iOS,
Android and the web, so a card looks the same wherever it appears.

## Entries

| Entry              | What it holds                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------ |
| `.`                | The canvases, their constants and colors, and the drawings                                 |
| `./primitives`     | The SVG drawing elements, resolved to `react-native-svg` on phones and plain SVG elsewhere |
| `./server`         | `renderCardPng` and `assertFontFiles`, the PNG renderer and its font check                 |
| `./assets/fonts/*` | The four committed faces as TTF and WOFF2, with their checksums and licences               |

`./server` is imported only by the API and the worker. It is the one part of `src/` that uses
`react-dom`, `@resvg/resvg-js` or Node built-ins.

## Rules

- The package imports only `@citizenrun/shared` and React. It holds no platform code: no React
  Native, no Expo module, no platform file suffix, no `fetch` and no translation instance. Text
  functions take `t` as an argument, and every color arrives as a prop.
- The renderer never fetches anything and never reads system fonts. It loads only the four TTF
  files under `assets/fonts/`, and refuses markup that could reach outside the canvas.

## Tests

```sh
pnpm exec vitest run --project unit:cards
pnpm --filter @citizenrun/cards typecheck
```
