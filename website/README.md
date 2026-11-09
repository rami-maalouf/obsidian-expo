# Sapphire's website

The one-page site for Sapphire at [sapphire.orbitlabs.studio](https://sapphire.orbitlabs.studio):
what the app does, in a few lines, around the hexagonal Prism mark. Visitors join a waitlist;
on iOS they get the public TestFlight invite after signing up, and on Android they stay on the
email list until a build ships.

It is plain HTML, CSS and one module, bundled by [Bun](https://bun.sh) into static files, with a
Vercel edge function for the waitlist.

| File | What it is |
|---|---|
| `src/index.html` | The page: cave hero with the raw stone, the lit statement, the close, waitlist dialog. |
| `src/privacy.html`, `src/support.html` | Privacy and support, at `/privacy` and `/support`. |
| `src/styles.css` | The look: near-black, grey cave rock, one raw teal stone, big quiet type. |
| `src/main.js` | Entrances, the word-by-word statement, waitlist flow (`/?join=ios` or `/?join=android` opens it), and deferred load of the scene. |
| `src/scene.js` | The live scene (Three.js): a procedural cave painted once per size, and a raw sapphire crystal with host rock still on it. Slow turn, cursor lean, dust in the light. |
| `api/waitlist.ts` | Notion-backed waitlist (`App: sapphire`, Platform iOS/Android). |
| `src/img/` | Icon cuts, the share image, and `stone.png`: a still of the stone for the close and for browsers without WebGL. To refresh it, open `/?capture` and save the 640 px canvas with a transparent background. |
| `src/public/fonts/` | Sora, Geist and Geist Mono (SIL OFL). |
| `build.ts` | Bundles the pages into `dist/` and adds the fixed-address files. |

```sh
bun install
bun run preview    # build, then serve dist/ on a local port
bun run build      # dist/, ready for any static host
./deploy.sh        # build and publish to Vercel (project "sapphire")
```

Set `NOTION_API_KEY` and `NOTION_WAITLIST_DATASOURCE_ID` on the Vercel project. Add a `sapphire`
option to the Notion waitlist `App` multi-select if it is missing. Attach
`sapphire.orbitlabs.studio` once.

Local preview stubs the waitlist as successful so you can check the TestFlight handoff without
Notion. Keep each claim true to the app: the repository README and validation docs are the source.
The public TestFlight link is `https://testflight.apple.com/join/2MvTg1jW`.
