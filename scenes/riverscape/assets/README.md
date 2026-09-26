# Riverscape textures

Photographic textures from Poly Haven, redistributed under [CC0](https://polyhaven.com/license).
Files are bundled locally; the wallpaper makes no requests to Poly Haven at runtime.

| Material | Source | Colour | Normal | Surface properties |
| --- | --- | --- | --- | --- |
| Driftwood | [Rough Wood](https://polyhaven.com/a/rough_wood), Rob Tuytel | `rough_wood_diff_4k.jpg`, 4096² | `rough_wood_nor_gl_2k.png`, 2048² | `rough_wood_arm_2k.jpg`, 2048² |
| Stones | [Rock Boulder Dry](https://polyhaven.com/a/rock_boulder_dry), Dimitrios Savva / Rico Cilliers | `rock_boulder_dry_diff_4k.jpg`, 4096² | `rock_boulder_dry_nor_gl_2k.png`, 2048² | `rock_boulder_dry_arm_2k.jpg`, 2048² |
| Sand | [Sand 01](https://polyhaven.com/a/sand_01) | `sand_01_diff.jpg`, 1024² | `sand_01_nor_gl.jpg`, 1024² | Constant roughness |

Colour maps use sRGB. OpenGL normal maps and packed ARM maps use linear data:
red = ambient occlusion, green = roughness, blue = metalness. Wood and stone are
nonmetallic; their materials share one ARM texture for occlusion and roughness and
ignore the metalness channel. Lossless PNG normals avoid JPEG block artefacts in
lighting. Normal and ARM maps stay at 2K to limit memory while 4K colour resolves
grain in close views. Mipmaps and anisotropic filtering remain enabled.

The older 1K wood/stone JPEG files are retained but are no longer loaded.

The six upgraded source files were downloaded unmodified on 2026-09-25. Their
Poly Haven API metadata is available at `https://api.polyhaven.com/files/rough_wood`
and `https://api.polyhaven.com/files/rock_boulder_dry`. MD5 checksums from that metadata:

```text
3c6d37c559b9dd8ab9bf2d192f0ae629  rough_wood_diff_4k.jpg
198eec08d20acddfd651956fba2fc538   rough_wood_nor_gl_2k.png
2f6ee37ee8810aeeb72a14a7d345ba9f  rough_wood_arm_2k.jpg
7a678cbefc5d377b11fa9784e5493bde  rock_boulder_dry_diff_4k.jpg
b2194a35fed98675ad217a22d4e21535  rock_boulder_dry_nor_gl_2k.png
acee3a43c7fc3bbe79c343cb3bb3b113  rock_boulder_dry_arm_2k.jpg
```
