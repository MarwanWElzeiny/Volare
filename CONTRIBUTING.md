# Contributing to Volare

Thanks for taking the time. This is a small project, so the process is light.

## Before you start

For anything beyond a bug fix or typo, **open an issue first**. It saves you
building something that does not fit the direction, and me reviewing a PR I
have to turn down.

## Getting set up

```bash
git clone https://github.com/MarwanWElzeiny/Volare.git
cd Volare
npm install
npm start
```

Then open <http://localhost:3000>. There is **no build step** — Volare ships as
raw ES modules and loads directly in the browser. Edit a file under `SDK/` and
refresh.

The Node server is only needed for the demo pages and the optional protected
asset delivery. The viewer itself runs on any static file server.

## Before you open a PR

All three must pass:

```bash
npm run validate && npm test && npm run security:audit
```

- `validate` — repo structure, path casing, no stray dev directories
- `test` — security envelope, VLB crypto, and SDK lifecycle tests
- `security:audit` — nothing private or forbidden in the public export

Then do a manual browser pass. **This matters more than it sounds** — most real
bugs in this project have been layout and timing issues that no automated test
caught. [docs/TESTING.md](docs/TESTING.md) has the procedure.

## Code conventions

- **No build tooling.** Plain ES modules, no transpilation, no bundler. If a
  change needs a build step, open an issue before writing it.
- **No new runtime dependencies.** Three.js is the only one, and it is a peer
  dependency. Adding another is a design decision, not an implementation
  detail.
- **Match the surrounding style.** Comment density, naming, and structure of
  the file you are editing.
- **Clean up after yourself.** Anything added to the DOM or any listener
  registered must be removed in `dispose()`. Viewers get created and destroyed
  repeatedly.

## Things that are easy to get wrong

- **The WebGPU renderer initializes asynchronously.** Anything touching the
  renderer at startup may run before the backend exists. Await
  `renderer.init()` where it matters.
- **CSS must work at any container size.** The viewer can be embedded in a
  small panel, not just full-viewport. Scope to `.vlr-embed-container` rather
  than assuming the whole window.
- **Do not hardcode UI lists.** Things like the HDRI presets come from a
  registry so integrators can extend them.

## Reporting bugs

Include the browser and OS, whether it reproduces on `examples/minimal`, the
console output, and the model format if loading is involved.

For security vulnerabilities, do **not** open a public issue — see
[SECURITY.md](SECURITY.md).

## License

Contributions are licensed under the MIT License, same as the project.
