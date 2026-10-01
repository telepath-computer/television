// Workshop routes and page fixtures derived from the design manifests. This
// module never reads the baked release tree or repeats document content.
import {
  DEFAULT_PAGE_GEOMETRY,
  DEFAULT_PAGE_SIZE,
  type PageGeometry,
  type PageSize,
} from "../../packages/shared/src/types.ts";

interface Card {
  id: string;
  slug: string;
  title: string;
  size?: PageSize;
  geometry?: PageGeometry;
  skill?: string;
  components?: boolean;
}

interface Manifest {
  name: string;
  cards: Card[];
}

const manifests = import.meta.glob<Manifest>("/specs/ui/onboarding-artifacts/*/layout.yml", {
  import: "default",
  eager: true,
});
const sources = import.meta.glob("/specs/ui/onboarding-artifacts/*/*.{frame,md}", {
  query: "?raw",
  import: "default",
});
const markdownPreviews: Record<string, string> = {
  "/specs/ui/onboarding-artifacts/research/draft-blog-post.md": "/frames/onboarding/draft-blog-post",
};

/** The four channel fixtures, including the document dependency metadata. */
export const channels = Object.fromEntries(Object.entries(manifests).map(([path, manifest]) => {
  const directory = path.slice(0, path.lastIndexOf("/"));
  const slug = directory.slice(directory.lastIndexOf("/") + 1);
  const pages = manifest.cards.map((card) => {
    const source = `${directory}/${card.slug}`;
    const markdown = `${source}.md` in sources;
    const src = markdown ? markdownPreviews[`${source}.md`] : source;
    if (!src || (!markdown && !(`${source}.frame` in sources))) {
      throw new Error(`No onboarding preview for ${source}`);
    }
    return {
      ...card,
      name: card.title,
      src,
      markdown,
      ...(card.size ?? DEFAULT_PAGE_SIZE),
      geometry: card.geometry ?? DEFAULT_PAGE_GEOMETRY,
    };
  });
  return [slug, { name: manifest.name, pages }];
}));

export default channels;
