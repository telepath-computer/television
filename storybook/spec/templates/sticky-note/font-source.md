# Caveat font source

`Caveat-Medium.woff2` is Caveat at weight 500, with all 1,034 upstream glyphs retained. It is 109,988 bytes. The stories load this file; a packaged Sticky note carries its own identical copy.

- Source: [Google Fonts, Caveat variable font](https://raw.githubusercontent.com/google/fonts/5571d84c0d8c70ec1af4f64072d8c5cf1e4e9643/ofl/caveat/Caveat%5Bwght%5D.ttf).
- Licence: [SIL Open Font License 1.1](https://raw.githubusercontent.com/google/fonts/5571d84c0d8c70ec1af4f64072d8c5cf1e4e9643/ofl/caveat/OFL.txt), Copyright 2014 The Caveat Project Authors. The upstream notice declares no Reserved Font Name. The complete notice is reproduced in [THIRD-PARTY-NOTICES.txt](./THIRD-PARTY-NOTICES.txt).
- Source SHA-256: `0bdb6b660482d31531b3945849fba5916b3ef8695da7024a9e6b9ee3c4157988`.
- WOFF2 SHA-256: `a66e7797998036410fa7411c422851c56d39efa6fa60f367be93c87c3b8bf9bd`.

The source repository supplies TrueType. Television extracted weight 500 and converted it to WOFF2 with fontTools 4.67.0 and Brotli 1.2.1, without subsetting glyphs or changing outlines:

```python
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

font = TTFont("Caveat[wght].ttf", recalcTimestamp=False)
font = instantiateVariableFont(font, {"wght": 500}, inplace=True)
font.flavor = "woff2"
font.save("Caveat-Medium.woff2")
```

The resulting font remains under OFL 1.1. Its inventory record covers the story copy and generates this folder's notice and the repository notice. Packaging adds the production copy to the inventory and generates its own folder notice as specified by the [template architecture](../../../../specs/arch/templates/sticky-note.md#packaged-page-and-guidance).
