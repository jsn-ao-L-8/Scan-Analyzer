# Physical iPad test record

Fill this out before a release. An unchecked item is a release blocker unless
the limitation is explicitly documented.

## Device

- Date:
- Tester:
- iPad model:
- Memory tier:
- iPadOS version:
- Safari version/build:
- Application version and commit:

## Install and offline

- [ ] First online load completes.
- [ ] Add to Home Screen succeeds.
- [ ] “Ready offline” appears.
- [ ] Airplane-mode Home Screen relaunch succeeds.
- [ ] Analysis makes no network requests.
- [ ] A prompted update replaces the complete version.

## Files

- [ ] Multiple local `.csv` files select together.
- [ ] Multiple Google Drive `.csv` files select together.
- [ ] A Drive file not cached locally gives understandable provider behavior.
- [ ] Extensionless comma-separated file is selectable, or rename fallback is
      confirmed.
- [ ] Malformed numeric and malformed-row errors name the file and source row.

## Interaction

- [ ] Portrait controls and stacked plots remain usable.
- [ ] Landscape dual plots remain usable.
- [ ] All targets are comfortably touchable.
- [ ] Pan, pinch zoom, autoscale, and reset work.
- [ ] Touch FFT range does not accidentally pan.
- [ ] Manual and touch ranges produce identical output for equal bounds.
- [ ] On-screen keyboard does not obscure the active range field.

## Export

- [ ] Analysis CSV and JSON share together.
- [ ] Statistics CSV saves locally and into Drive.
- [ ] Time, spectrum, and combined PNGs save locally and into Drive.
- [ ] Full-resolution exported arrays are not display-downsampled.

## Performance

- [ ] One million aggregate rows import without terminating the app.
- [ ] Controls continue repainting during worker activity.
- [ ] Post-import analysis completes within five seconds.
- [ ] Repeated settings changes do not leak memory.
- [ ] Plot rendering remains responsive through display downsampling.
