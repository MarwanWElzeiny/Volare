# Media

Assets referenced by the root `README.md`.

## Needed

| File | Purpose | Spec |
|---|---|---|
| `hero.gif` | Top of the README | ~800px wide, under 5MB, silent, loops |

## Recording the hero clip

There is a purpose-built capture page — no browser chrome, no cursor, no
mis-clicks:

```bash
npm start
```

Then open:

```
http://localhost:3000/examples/capture/index.html?w=1600&h=900&spin=8
```

Press **P** to export a PNG sequence, or **R** for WebM. See
[`examples/capture/index.html`](../examples/capture/index.html) for all URL
parameters.

For a clip that shows the UI as well as the model, screen-record
`DEMO/direct.html` instead: open the Visual Toolkit, toggle Wireframe → Ambient
Occlusion → Original, then a cross-section pass. Move the mouse slowly.

Keep it under 12 seconds. GIF bands badly on smooth gradients — if the HDRI
background looks blotchy, record against a solid or transparent background
instead.
