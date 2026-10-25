*Artifact records: the stored path and URL shapes, their creation and update inputs, and the per-artifact transparency setting.*

# Artifact records

An artifact record identifies the content Television shows. This spec owns its stored shape and the create and update inputs that set its fields. The registry and other record behavior remain code-authoritative outside requirements already owned by [product artifacts](../../product/artifacts.md) and the other specs cited here. The resource layer retains the [record save rules](../resources/index.md#^rs-artifact-record).

## Record shape

The file at `<home>/state/artifacts/<id>.json` contains one `Artifact`, with `id` matching the filename. Records have no version field. The same shape is carried in artifact API results and events. ^ar-record

```ts
interface PathArtifact {
  readonly id: string;
  readonly kind: "path";
  readonly title: string;
  readonly path: string; // absolute
  readonly transparent?: boolean;
  readonly store?: ResourceID;
  readonly share?: ArtifactShareLink;
}

interface UrlArtifact {
  readonly id: string;
  readonly kind: "url";
  readonly title: string;
  readonly url: string; // http(s)
  readonly transparent?: boolean;
}

interface ArtifactShareLink {
  readonly id: string;
  readonly access: AccessLevel;
}

type Artifact = PathArtifact | UrlArtifact;
```

The product spec owns [artifact IDs](../../product/artifacts.md#^af-artifact-id) and [titles](../../product/artifacts.md#^af-name). `ResourceID` and `AccessLevel` are [resource types](../resources/index.md#records). The resource layer owns [store eligibility](../resources/index.md#^rs-has-store), the [store pointer](../resources/index.md#^rs-own-store-binding), and [share-link changes](../resources/index.md#^rs-share-change). A record without `store` or `share` has no store yet or no share link, respectively.

## Create and update inputs

The path and URL creation request carries:

```ts
type NewArtifact =
  | { kind: "path"; title: string; path: string }
  | { kind: "url"; title: string; url: string };

type CreateArtifactRequest = NewArtifact & {
  channelID: string;
  display?: ArtifactDisplayOptions;
  before?: string;
  after?: string;
};

type ArtifactPatch = {
  title?: string;
  path?: string;
  url?: string;
  transparent?: boolean;
};
```

`ArtifactDisplayOptions` and its input value rules belong to [layout](../layout/index.md#^ly-creation-display), as does [placement](../layout/index.md#^ly-placement). Template creation uses its own [request contract](../templates/index.md#creating-an-artifact) and produces an ordinary path or URL record.

Creation and repointing follow the [path](../../product/cli.md#path-artifact-creation) and [URL](../../product/cli.md#url-artifact-creation) target rules, including normalization of the stored pointer.

The update request identifies an artifact and supplies an `ArtifactPatch`. At least one field is required. Supplied fields must match their types before any record change; omitted fields keep their current values. `path` and `url` are mutually exclusive and can only repoint the corresponding artifact kind. ID and kind stay fixed. The resource layer manages `store` and `share` through its operations.

## Transparency

The top-level `transparent` field controls [artifact transparency](../../product/artifacts.md#^af-transparent) for either kind. Only `true` is ever stored, and absence means opaque, including on records written before the field existed. ^ar-transparent

At creation, the request's `display.transparent`, after any [template resolution](../../product/templates.md#^artifact-template-display-options), sets the field; without a value the artifact is opaque. An update's `transparent` sets the field when `true`, removes it when `false`, and keeps it when omitted.
