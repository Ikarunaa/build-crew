# Build Crew

A Chrome extension that blanks any web page, then has a crew of coloured
"AI agent" cursors rebuild it in front of you: they drag out wireframe boxes
with live size badges, type the text with a blinking caret, and swap each
piece in for the real thing. Made for screen recordings of your own site.

## Install (unpacked)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the `extension` folder.
4. Pin the extension from the puzzle-piece menu so the icon is easy to reach.

## Use

- Open any site and click the icon, or press **Alt+Shift+B**.
- The page fades out, the crew circles the site's icon while it scans, then
  gets to work on whatever is in view.
- **Scroll** and the crew follows. Scroll fast and more agents join (up to 24).
- **Tour** auto-scrolls at the crew's pace, which is best for recordings.
- **1× / 2× / 3×** changes the build speed.
- When it's done the crew gathers around your mouse. **Go live** returns
  the real page and **Replay** builds it again.
- **Esc** or the **✕** button stops at any time and restores the page.

To record a video like the reel: open your site, press Alt+Shift+B, click
Tour, and record the screen (Cmd+Shift+5 on a Mac).

## Try it without installing

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765/demo/index.html?run (or press Alt+Shift+B
on that page).

The `portfolio/` folder is Karuna's personal site. Open
http://localhost:8765/portfolio/index.html?run to watch the crew rebuild it.

## How it works

`extension/content.js` does everything; `background.js` only injects it when
you click the icon.

1. **Scan.** Every visible element that draws something (a background,
   border, image, form control or its own text) becomes a "layer". Inline
   tags inside a paragraph are folded into it so it's typed as one block.
2. **Hide.** A stylesheet hides everything except layers marked as built.
   The page's layout never changes, so built pieces land in exactly the
   right place.
3. **Build.** Each agent takes the next unbuilt layer in view (parents
   before children), flies there on a curved path, drags out a wireframe
   box, types any text into a look-alike overlay, then reveals the real
   element and moves on. All agents run in parallel.
4. **Clean up.** Everything the extension adds lives in one shadow-DOM
   element plus one `<style>` tag, and is removed on exit.

Nothing is collected or sent anywhere. The extension only runs on the tab
where you click it, and only uses the `activeTab` and `scripting`
permissions.

## Limits

- It can't run on `chrome://` pages, the Chrome Web Store or the PDF viewer.
- Pages that scroll inside an inner container (instead of the window) build
  fine, but wireframes don't follow that inner scroll.
- Content inside iframes appears as a single box.
- The typing overlay copies the element's font but can wrap slightly
  differently from the real text; the real element replaces it a moment later.

## Regenerate the icons

```bash
python3 scripts/make_icons.py
```

## Credit

The idea of a page being rebuilt by a swarm of multiplayer cursors comes
from Joel Califa's "Swarm" site. This is an independent implementation: no code was taken from
any project.
