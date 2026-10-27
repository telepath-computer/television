# Lucide place icons

This folder contains the 30 place-icon names supported by Map, using 29 SVG designs from the official [lucide-static 1.61.0 package](https://registry.npmjs.org/lucide-static/-/lucide-static-1.61.0.tgz). The package was downloaded on 2026-10-25 and checked against the SHA-512 integrity value published by the npm registry:

```text
sha512-yLAiQB3MWUJEstsEDAwenSA3m7vr1tdLvgnC16Q/XMxRRma0DWwMs8M2bWlvgShrIs1m2mWMJ+0AiahqQO4GrA==
```

`svg/` contains unchanged upstream SVG bytes, named after the Map aliases below. `icons.js` contains the same child elements and attributes as JavaScript data for DOM creation. It exports `icons`, an object keyed by the Map names; each value is an array of `[tagName, attributes]` tuples. Render those elements inside an SVG with `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `stroke-width="2"`, and round line caps and joins. The page uses this local module and makes no request to an icon CDN.

The conversion preserves the upstream geometry. `museum` and `landmark` share the upstream `landmark` drawing; Lucide 1.61.0 has no separate museum icon. The aliases describe place types and remain independent of upstream filenames.

| Map name | Lucide source |
| --- | --- |
| `pin` | [`map-pin`](https://lucide.dev/icons/map-pin) |
| `landmark` | [`landmark`](https://lucide.dev/icons/landmark) |
| `museum` | [`landmark`](https://lucide.dev/icons/landmark) |
| `restaurant` | [`utensils`](https://lucide.dev/icons/utensils) |
| `coffee` | [`coffee`](https://lucide.dev/icons/coffee) |
| `bar` | [`martini`](https://lucide.dev/icons/martini) |
| `hotel` | [`hotel`](https://lucide.dev/icons/hotel) |
| `park` | [`trees`](https://lucide.dev/icons/trees) |
| `beach` | [`umbrella`](https://lucide.dev/icons/umbrella) |
| `mountain` | [`mountain`](https://lucide.dev/icons/mountain) |
| `viewpoint` | [`binoculars`](https://lucide.dev/icons/binoculars) |
| `shop` | [`store`](https://lucide.dev/icons/store) |
| `airport` | [`plane`](https://lucide.dev/icons/plane) |
| `train` | [`train-front`](https://lucide.dev/icons/train-front) |
| `bus` | [`bus`](https://lucide.dev/icons/bus) |
| `parking` | [`square-parking`](https://lucide.dev/icons/square-parking) |
| `hospital` | [`hospital`](https://lucide.dev/icons/hospital) |
| `school` | [`school`](https://lucide.dev/icons/school) |
| `home` | [`house`](https://lucide.dev/icons/house) |
| `work` | [`briefcase-business`](https://lucide.dev/icons/briefcase-business) |
| `star` | [`star`](https://lucide.dev/icons/star) |
| `heart` | [`heart`](https://lucide.dev/icons/heart) |
| `flag` | [`flag`](https://lucide.dev/icons/flag) |
| `music` | [`music`](https://lucide.dev/icons/music) |
| `theatre` | [`theater`](https://lucide.dev/icons/theater) |
| `sports` | [`dumbbell`](https://lucide.dev/icons/dumbbell) |
| `church` | [`church`](https://lucide.dev/icons/church) |
| `bridge` | [`bridge`](https://lucide.dev/icons/bridge) |
| `ferry` | [`ship`](https://lucide.dev/icons/ship) |
| `info` | [`info`](https://lucide.dev/icons/info) |

[LICENSE](./LICENSE) is the complete, unchanged package licence: Lucide ISC terms followed by the inherited Feather MIT notice and the upstream list of affected icons. Keep it with these assets. The source project is [lucide-icons/lucide](https://github.com/lucide-icons/lucide).
