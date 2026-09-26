# Riverscape

A planted forest aquarium based on the supplied aquascape reference: staggered upright
driftwood, low green planting and dark stones edging a winding golden sand path.
The scene uses its own procedural plants, geometry and lighting; the reference image
is not included as a runtime asset.

## Interactions

- Move slowly near the fish: nearby individuals make room without a panic response.
- Hold the pointer still near fish for several seconds: a few may approach and inspect it.
  Each has a different confidence and cooldown, and no more than three inspect at once.
- Move abruptly toward nearby fish: a local alarm can spread through their neighbors.
- Hover beside a shrimp: it scuttles away. A fast approach or a very close lingering
  cursor triggers a backward tail-flick, a short swim and a new landing. The cursor
  ray reaches shrimp on deeper wood as well as foreground stones.
- Click the water or select Feed to drop 30 pellets: fish look for visible pellets and favor less contested
  food. Rocks and driftwood block sight; a lost pellet is pursued briefly from memory.
- Pause, hide the page or stop the wallpaper: motion and interaction clocks stop.
  Returning to the scene clears stale pointer velocity.

The macOS wallpaper uses the same interactions, with feeding available from its menu.
These behavior timings are tuned for the experience, not a calibrated biological model.

## Appearance

Seven thick trunks have individual lean, girth, weathered grain, recessed knots and short
branch stubs. Each extends from the sloped substrate past the upper edge of the view,
with wide openings between them and staggered depth. The shared layout
in `src/layout.js` keeps the small stones and planting along an S-shaped path, leaving
the sand open. A dense carpet of small cupped leaves forms low cushions. Five overlapping
beds of ribbon grass and fuller stem-plant groups fill the background between the wood;
shorter grass behind the path preserves the view into the distance.
Three further layers add 36 slimmer trunks, tall fine grass and small-leaved shoots
behind the main planting. Their smaller silhouettes and lower contrast recede toward
the backing, filling the upper gaps while preserving the open foreground path.

The camera is 20% farther back than the previous layout and slightly higher, revealing
more of the wood and substrate. A visible water surface at the top reflects the real
aquascape, with gentle animated distortion and a faint waterline. Its small reflection
texture is baked on initial display and camera changes; animals are excluded from
that cached image. Surface ripples share the simulation clock and stop when paused.
Wood, stones and each planting group are batched, including the new distant layers.
Fish avoid the trunks and can investigate their surfaces.
Initial placement excludes the hardscape; contact resolution keeps fast food strikes
outside the wood while preserving motion along its surface.

Wood and stone use 4K photographic colour, lossless 2K normal maps and shared 2K
occlusion/roughness maps from [Poly Haven](assets/README.md). Stone textures project
across three axes at a consistent world scale, avoiding pinching at spherical UV poles.
Wood grain follows each branch, with spacing based on its girth and a different offset
per piece. Restrained vertex tint and a thin algae blend retain the source grain and
mineral detail; the surface relief remains visible beneath moss. These material changes
add no geometry or draw calls. The higher-resolution maps increase texture memory and
initial load size; rendering still uses the existing resolution and frame-rate budgets.

The 29 fish are neon tetras (*Paracheirodon innesi*), modeled from live-fish references
including [Aquarium Co-Op's photographs](https://www.aquariumcoop.com/blogs/aquarium/neon-tetras-and-cardinal-tetras).
The blue stripe changes from cobalt to turquoise with the viewing angle. Red pigment
covers the rear body, leaving the anterior belly silver; the fins are mostly clear.
The mesh includes a tapered caudal peduncle, swept dorsal and anal fans, a shallow
cornea, and a gill cover that moves during ventilation. Jaws open during food strikes.
Individuals have subtle differences in body proportions, pigmentation and breathing
phase. Appearance and motion are artistic approximations, not a biological simulation
calibrated for this species. Reference photographs are not bundled or loaded at runtime.

Five red cherry shrimp (*Neocaridina davidi*) roam the substrate, stones and main trunks.
Their proportions and colouring follow the supplied
[Fishi-Pedia reference photographs](https://www.fishi-pedia.com/crustacea/neocaridina-davidi):
a rising head shield, six scalloped abdominal plates, a narrow fringed tail fan,
small dark eyes, irregular crimson pigment, fine antennae and red legs with clear joints.
The opaque parts of the shell conceal the far-side legs; thin chitin stays translucent.

Independent clocks alternate grazing and crawling with swims to other surfaces.
An obstacle-aware route planner keeps transfers clear of the hardscape. Bark sampling
uses the actual trunk mesh, including its lean and knots; indexed rock triangles
support the feet on stones. Steep ledges trigger a swim instead of a walk across an
unreachable step. The body turns toward the landing surface and its legs unfold before
grazing resumes. Cursor escapes curl the abdomen and propel the whole animal backward,
with a cooldown to prevent constant retriggering. All five shrimp share the aquarium's
pause and capture clocks. They do not consume fish pellets.

Shell translucency is approximated with light scattering, alpha and reflective shading;
this is a real-time procedural model, not photographic or path-traced imagery.

## Rendering quality

Riverscape defaults to **Ultra**, rendering at least 1.5× CSS resolution up
to **3840 × 2160 pixels** (8.29 MP), with a **30 fps** target. A 1920 × 1080 display
renders at 2880 × 1620 and downsamples for cleaner leaves, fish fins and antennae;
Retina uses its native density within the cap. Larger displays preserve
their aspect ratio within that pixel budget. Rendering speed depends on the GPU and
other workloads; the target is not a frame-rate guarantee.

On battery, Ultra keeps its selection but uses the Balanced pixel budget (1.8 MP) and
a 20 fps cap. Plugging in restores full resolution. Eco, Balanced and Detail retain
their previous budgets. Switching quality preserves the fish, plants and simulation
time; 4× multisampling is retained for fine foliage and fin edges.

Ultra uses 4096² shadow maps and 12-sample, normal-aware contact shading with a small
world-space radius, plus subtle contrast bounded by neighbouring colours. On battery
these return to 2048² shadows and 8 samples. Quality changes update the actual render
resources even while paused. Texture filtering uses up to 16× anisotropy where supported.
The stones' contact shadows are instanced. The distant plants and trees each add one
draw call, and the water reflection adds no recurring scene render pass.

In the browser, use the quality selector. Riverscape stores its choice independently
from Reefscape. In the macOS menu, choose **Riverscape Quality → Ultra · Up to 4K**;
the native preference survives app restarts and applies to every display.

## Development

Run `npm start` at the repository root, then open `/scenes/riverscape/`.
Run `npm run check` and `npm test` for syntax and regression checks. The existing fish
behavior suite also runs `tests/interaction.mjs` and `tests/neon-anatomy.mjs`. These
check pointer behavior, mesh validity, independent ventilation, fixed appearance and
pause handling. The feeding suite verifies that actual strikes open the jaws.
`tests/cherry-shrimp.mjs` checks finite anatomy, exact bark and rock sampling, seven
minutes of floor/wood roaming, foot contact, landing, obstacle-free swim routes,
gentle retreat, tail-flip escape, recovery, cooldown and frozen pause state.

For a reproducible still, use `/scenes/riverscape/?capture=1&time=18`. Capture mode pauses
the scene, hides controls and advances the actual simulation by the requested number of
seconds (0–120). Append `&quality=ultra` for the native/4K budget, or `&quality=balanced`
for a lower-cost comparison.

`?diagnostics=1` enables the existing local `habitatBenchmark()` tool. `habitatStats()`
includes fish and shrimp states, observations, feeding counts, pointer state and rendering budgets.
