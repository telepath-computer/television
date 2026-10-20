# The Checklist artifact template — proposal

**Status:** settled by Rupert on October 16 and 19, 2026; no open questions. The template mechanism is in draft PR #38 with one placeholder template, Example. This change replaces Example with the Checklist as the bundled template.

The template is an ordinary template folder: `manifest.json`, an `index.html` page, a `data.json` starting value for the artifact's JSON store, a `README.md` for an agent adapting the copy, and a portrait `thumbnail.png` (4:5, about 400 by 500 pixels), a screenshot of the page with sample data. The page reads its store through the resource SDK and updates live when an agent writes with `tv resource json`.

**Settled by Rupert on October 16, 2026.** The page's look and behaviour are the UI spec pilot: the stories and `styles.css` in `storybook/spec/templates/checklist/` and the prose page `specs/ui/templates/checklist.mdx`: a sheet of paper with an editable title, items that tick, edit in place and wrap, and an "Add an item" field.

```ts
interface ChecklistData {
  title: string;
  items: Record<string, { order: number; text: string; done: boolean }>; // keys from push
}
```

Decisions:
1. Return in the title adds a new, empty item at the top and puts the caret in it; Return in an item adds a new, empty item directly below it. An item left empty is removed.
2. Done items stay in place, muted and struck through. No reordering in the first version.
3. When an agent or another viewer changes the item a person is editing, the person's text wins. Other changes show at once.
4. Read-only when the page's access to its store is `read` (a read-only share link) or `null` (no access, as after the link is revoked), detected through the SDK's `getAccess` and `onAccessChanged`; it switches live as access changes.
5. Starting size about 640 by 800 reference pixels, through the template's display options.
6. A new checklist has the title "Checklist" and no items, with the add field focused.
7. The Example template is deleted when Checklist ships; it was never released.

Further decisions, October 16–17, 2026, recorded in the pilot (`specs/ui/templates/checklist.mdx`):

8. When two writers change the same item, the last write wins. An item removed elsewhere while being edited is written back whole if the person keeps typing or leaves it with text; left empty, it stays removed.
9. While the page cannot reach its server it is read-only with "Reconnecting…" at the top; a refused save reverts that change and shows "Couldn't save that change." for a few seconds.

Settled by Rupert on October 19, 2026, recorded in the pilot:

10. Backspace in an empty item removes it and puts the caret at the end of the item above. With no item above, as when it is the only item, it does nothing.
11. Up and Down move the caret to the item above or below at an item's first or last line; Up from the first item goes to the title, Down from the last item to the add field.
12. Pasting several lines into an item or the add field makes one item per line, skipping blank lines.
13. Cmd- or Ctrl-Return ticks or unticks the item being edited. Items cannot be nested.
14. When the artifact is narrower than the sheet and its margins, the sheet fills the page edge to edge.
15. An empty checklist opened read-only shows the title and a muted "No items".
16. No "Clear done" action in the first version.

Settled by Rupert on October 19, 2026, after a completeness check of the spec:

17. The page reads the data whole or not at all. Data that breaks the store contract anywhere shows an error page instead of the checklist: centred on the desk, a warning icon, "This checklist can't be shown" and a muted line asking the person's agent to check it. The page never rewrites what it cannot read.
18. Defaults for spaces and line breaks: an item holding only spaces counts as empty; text saves as typed; the title and each item are one line, Shift-Return acts as Return, and lines pasted into the title are joined with spaces.
19. Until the data first arrives, the sheet is blank, with no loading message.
20. After the remove button, focus moves to the next item, else the item above, else the add field. A removed item cannot be brought back from the page in the first version.
21. No drag to reorder in the first version.
22. "Reconnecting…" and "Couldn't save that change." show in a strip along the bottom of the page, ruled off by a 1px line in the border colour.
23. Each story's frame is the artifact: 640 by 800 at the starting size, 360 by 640 for a narrow artifact. Stories hold only the page's own markup, since conformance tests compare against them; there is no hover story.
