# Focus soundscapes — field recordings

The writing session's **Sound** menu (top-left of a full-screen session) has two groups:

- **Generated · no download** — Brown noise, Pink noise, Rain (generated). These are synthesized live in
  the browser with the Web Audio API. Nothing to host, no licensing, works offline. They work out of the box.
- **Field recordings** — real recordings streamed from this folder. Until the files below exist, those
  options show greyed-out ("add file"). Drop the five files in and they light up automatically.

## Files the app looks for

Put these exact filenames in this `sounds/` folder (loopable ambient recordings, ~1–5 min each is fine —
they loop seamlessly enough for ambience):

| Filename      | Sound to use            |
|---------------|-------------------------|
| `rain.mp3`    | Steady rainfall         |
| `forest.mp3`  | Forest / birdsong       |
| `waves.mp3`   | Ocean waves             |
| `stream.mp3`  | Stream / running water  |
| `cafe.mp3`    | Café / coffee-shop murmur (~70 dB — the "moderate ambient noise aids creativity" level) |

Keep them modest in size (aim for < ~2–3 MB each; 96–128 kbps mono MP3 is plenty for ambience) so the
page stays light.

## Where to get truly-free (CC0 / no-attribution) files

Use **CC0** or "no attribution required" sources so nothing needs crediting:

- **Pixabay – Sound Effects** (no attribution): https://pixabay.com/sound-effects/search/rain/ ,
  `/forest/`, `/waves/`, `/stream/`, `/coffee-shop/`
- **Chosic – no-attribution filter**: https://www.chosic.com/free-music/all/?attribution=no
- **Freesound** – filter licences to **Creative Commons 0**: https://freesound.org/search/?f=license:%22Creative+Commons+0%22
  (free account needed to download; CC0 items need no credit)
- **Free-Stock-Music** CC0 loops: https://www.free-stock-music.com/

Download an MP3 from any of those, rename it to the filename above, and drop it here. Re-encode to mono
128 kbps if you want smaller files (e.g. `ffmpeg -i in.mp3 -ac 1 -b:a 128k rain.mp3`).

## Notes

- The Sound control is **off by default**, remembers your last choice + volume, plays **only during a
  writing session**, and pauses when the session ends or the tab is hidden. Volume is capped in a calm range.
- Evidence backdrop: natural soundscapes support attention restoration / working memory; brown & pink noise
  mask distraction (well-supported for ADHD, favourable otherwise); ~70 dB "café" ambience aids creative
  thinking (Mehta et al., 2012), while louder hurts — hence the volume cap.
- Want it fully bundled so users need nothing? Ship these five MP3s with the site; they'll be served at
  `/sounds/<name>.mp3` next to `index.html`.
