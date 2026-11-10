# Sharing what you built

## The HTML file

A page from `sims/build.mjs` has three.js, the fonts and the machine inlined, so it opens by double-click and needs no server or network. `scripts/smoke.mjs` opens it from disk with the network blocked to prove it. It needs a browser with WebGL2, which any recent desktop or phone browser has. Some mail systems block `.html` attachments, so zip it or use a link.

The exception is a page built with `{"external": {...}}` in `build.json`: it loads models from files next to the page, so send the folder.

## A private link (Claude Artifact)

Where the Artifact tool is available, publish the live page as an Artifact. The host wraps pages in its own document, so package it first:

```
node "$SKILL_DIR/scripts/package-artifact.mjs" teardown-out/dist/my-machine-live.html --title "My Machine" --bg "#eef1f2"
```

Then publish `teardown-out/dist/artifact/my-machine-live.html`. Use a two-to-four word name as the title. Pass the page's own background as `--bg`. Open the published link and press the buttons: the page runs inside a frame there, so it isn't the same test as running it from disk.

## The film

Upload the mp4 as it is where you can. To make it smaller for a limit:

```
ffmpeg -y -i final.mp4 -c:v libx264 -crf 24 -preset slow -pix_fmt yuv420p -c:a aac -b:a 160k -movflags +faststart small.mp4
```

Raise `-crf` for a smaller file. Then read one more `sheet.mjs --video` of the result, since the encoder decides how fine detail looks.

## A link that previews in a feed

X and Slack read the share card from the HTML and give up on a very large page. `sims/build.mjs` reports the size and its largest modules whenever a page goes over 1 MB, and `<name>.build.json` always has them. Three.js alone is about 730 KB of that, so a detailed machine goes a little over and that's fine for a file or an Artifact. If you're hosting it for link previews, move big models out with `build.json`.

## Before you send

Check what's in the page. Reference images, a watermark on an image, or a third-party model bundled into the build goes with the file. Keep references out of the build unless you have the right to share them.
