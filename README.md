# LA Parking Pulse

A vanilla HTML/CSS/JavaScript and D3 7 prototype for recording LADOT parking activity in a 9:16 frame.

## Run and record

Run `python3 -m http.server 8000`, then open http://localhost:8000. Use a 1080 × 1920 browser viewport for full-size recording, or 540 × 960 for preview. On wider screens, crop to the centered portrait frame.

1. Start with the LA outline and actual sensor locations. Playback rests at midnight; press Play to see occupancy across the city, including San Pedro.
2. Click **Zoom in** for **Central LA & the Westside**. This view fits the actual regional sensor locations tightly, including Hollywood, Westwood Village, Venice, the USC / Expo Park area, and Downtown. Zooming preserves the paused state; press Play to start the time lapse.
3. Use the selector above the map: **All areas**, **Compare areas**, or a specific neighborhood. Compare areas shows all five areas at the same simulated time and geographic scale.
4. The comparison stacks Westwood, Venice, and USC / Expo Park on the left, with Hollywood above Downtown on the right. The right column is wider, and Downtown spans the lower two rows. Cards devote their space to sensor dots and can be clicked to open an individual neighborhood.
5. Individual neighborhood views fit that area's sensor footprint and show the current camera window on an LA locator. Choose **All areas** to return to the central geographic map. **Zoom out** from the central map returns to LA.

All view changes preserve time and play/pause state. Geographic camera moves last 1.1 seconds, hold simulated time, and respect reduced-motion preferences. Comparison views switch directly without animating the dots.

Comparison projections use the minimum fitting Mercator scale across all five panels, centering each footprint at that same scale. This avoids enlarging sparse neighborhoods relative to Downtown. Empty space is intentional. Each map remains north up. Single-neighborhood views can zoom closer, while retaining the fixed 2-pixel activity dots.

The region selects longitude [-118.52, -118.20] and latitude [33.95, 34.14], then fits the selected sensor extent. Neighborhood groups use approximate coordinate windows and descriptive labels, not official neighborhood boundaries.

## Data and encoding

`sensor_locations.csv` supplies 3,799 valid rows, of which 3,571 are in the central/westside selection. Duplicate coordinates remain separate dots; no aggregation or clustering. Hover for SpaceID and BlockFace.

`one-day-state-change.csv` supplies August 11, 2026 events. Events join by SpaceID and sort by local wall-clock time, independent of the viewer's timezone. Equal timestamps retain CSV order. 2,172 events without locations are skipped. Only OCCUPIED and VACANT establish a state. The full day plays in 20 seconds and loops; every loop clears the prior day's state. One shared playback model paints the geographic map and all neighborhood panels.

Activity dots use a 1-pixel radius in the city overview and Central LA & Westside view and a 2-pixel radius in neighborhood closeups and comparison panels: occupied coral #F85C42 at full opacity, with vacant and unknown spots sharing gray #808080 at full opacity. A Weather-inspired sky gradient follows the simulated clock, with deep blue nights, warm dawn/dusk horizons, and muted blue daylight. Solar anchors for August 11, 2026 (PDT) come from [Griffith Observatory](https://griffithobservatory.lacity.gov/explore/observing-the-sky/whats-in-the-sky/the-sun/2026-sunrise-and-sunset/): civil dawn 05:45, sunrise 06:12, solar noon 12:58, sunset 19:44, civil dusk 20:11. Palettes are custom artwork and do not represent recorded weather conditions. Pausing freezes the sky, restarting restores midnight, and looping returns smoothly to night. Surrounding space stays black. Sensor states change immediately with no flashes, pulses, size changes, or transition effects.

## Validation and external assets

Sound is off by default. Select **Sound off** to enable it, then press Play. Audio uses `assets/looperman-dark-synth-seamless.wav`, derived from the original Looperman WAV with a 60 ms crossfade between its tail and head. The original remains intact. Native audio looping repeats the blended track continuously. Playback speed follows the occupied share of visible spots, smoothly ranging from 0.8× at 0% to 1.4× at 100%, at constant volume. Native pitch preservation keeps the loop's pitch stable. Unknown and vacant spots remain in the denominator, matching the gray dots. Comparison mode uses the combined coverage of its five panels, counting each sensor once. Pause and mute preserve the track position. Navigation and camera moves keep audio playing at its current speed while simulated time is held; occupancy-driven speed updates resume when the camera settles. Audio continues through each 20-second simulated day boundary. Explicit Restart resets the track to its beginning.

Run `node tests/playback.cjs` for timestamp parsing, CSV joins, state changes, pause/resume, restart, looping, initial pause, and camera time holds. Run `node tests/sound.cjs` for visible occupancy, track speed, pitch preservation, pause/resume, reset position, and loading races.

Browser checks verify regional animation, five panels, synchronized states, equal comparison scales, unclipped points at 360 × 640, card and selector navigation, individual-view locators, preserved paused time, pause/restart, and portrait layout at 540 × 960 and 360 × 640.

D3 loads from jsDelivr. The official city outline loads as WGS84 GeoJSON from https://maps.lacity.org/lahub/rest/services/Boundaries/MapServer/7. Polygon winding is normalized for D3. Internet access is required; loading failures display a message.

The location header always reads Los Angeles. Navigation uses two rows: Zoom out / All areas / Compare areas, then the five neighborhoods. On the city overview, Zoom in sits below the header on the left. Play/pause and restart use accessible icon buttons at the bottom right.

The edge.cse interface uses neutral typography, segmented navigation, faint panel borders, muted sky gradients, and a small footer wordmark. Comparison guidance lives in the expandable View info control; the north indicator is removed. LA outlines use neutral gray #747474. The SVG viewport crops the unclipped city outline visually without generating artificial geographic edges along the viewport.
