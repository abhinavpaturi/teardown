# Research and sources

Choose one variant, year, market and operating condition before you collect a number. Two official specifications can both be right for different versions. Say which one you chose, in `sources.json` and on the page.

Keep one record per number that matters, in `<name>-shared/sources.json`. The starter's test fails if a record disagrees with the model, and the starter's page shows the records under "Sources and limits".

```json
{
  "schemaVersion": 1,
  "scope": {"machine": "The selected variant", "year": "2025", "market": "EU"},
  "parameters": [
    {"id": "stroke", "value": 49.7, "unit": "mm", "basis": "published",
     "source": {"url": "https://maker.example/manual.pdf", "page": 23, "title": "Technical data", "accessed": "YYYY-MM-DD"}},
    {"id": "linkCentre", "value": [402, 604], "unit": "mm", "basis": "measured",
     "reference": "references/side.png", "method": "Axle-calibrated side projection",
     "uncertainty": "+/- 8 mm", "limitations": "Perspective and occlusion"},
    {"id": "dragArea", "value": 0.385, "unit": "m^2", "basis": "calibrated",
     "target": "Maker's top-speed claim", "limitations": "Not independent validation"},
    {"id": "camLift", "value": 9.5, "unit": "mm", "basis": "estimated",
     "limitations": "No published figure; scaled from a similar engine"}
  ],
  "assets": [{"path": "references/side.png", "url": "https://maker.example/photo", "rights": "Reference only: keep out of the build"}]
}
```

Those are examples of the format, not facts about any machine.

## Four kinds of number

- **Published:** the maker's manual, drawing or technical sheet. Name the document and page.
- **Measured:** taken from a reference image or a real part. Say how, and how far off it could be.
- **Estimated:** your judgement. Fine for geometry nobody publishes, as long as the page doesn't pass it off as a spec.
- **Calibrated:** tuned to hit a target. A model tuned to match a claimed 0-100 time is matched to that claim, and matching it proves nothing.

Never promote a convenient assumption into a manufacturer's figure. Prefer manufacturer sources, and keep a missing cam profile, pressure trace or aero map labelled as an estimate: simplify before you fabricate precision.

## Matching a shape

1. Use a dimension with known endpoints to set the scale. A tyre's nominal size isn't its rolling radius in a photograph.
2. Record the axes, the origin, the units and what you assumed about the camera. Use an orthographic fit only where the image supports it.
3. Match the side silhouette and the major centres, then use front, rear or three-quarter views to constrain width and volume.
4. Keep the overlays or comparison frames as evidence. A camera fit doesn't prove anything about the geometry you can't see.

## Two kinds of check

- **Consistency:** computed displacement, gear ratios, rigid link lengths, unit conversions, no NaN anywhere in the range. These show the model agrees with itself.
- **Validation:** comparison with an independently sourced measurement that wasn't used to choose the model's constants. Report the error and the conditions. Past the supported range, show the limit or clamp it where the visitor can see.

## Rights

Reading a reference doesn't grant the right to redistribute it. Keep licensed drawings and photos out of a page you'll share, and save the citations and the numbers instead. Keep source notes and any permitted reference files in the project, not in a session scratchpad.
