import { CompletionSource } from '@codemirror/autocomplete';
import { Extension } from '@codemirror/state';
import { KeyBinding } from '@codemirror/view';
import { LanguageSupport } from '@codemirror/language';
import { MarkdownExtension } from '@lezer/markdown';
import { StateCommand } from '@codemirror/state';

/**
 * Make all properties in T required and exclude null and undefined from them.
 *
 * @example
 * ```typescript
 * type LooseType = { optional?: string; required: string | undefined }
 *
 * type StrictType = Defined<LooseType> // { optional: string; required: string }
 * ```
 */
export declare type Defined<T> = {
    [P in keyof T]-?: NonNullable<T[P]>;
};

/**
 * Creates a {@link StateCommand} that smartly inserts a new markdown table.
 *
 * Defaults to a `2x2` table.
 *
 * The command inserts an empty markdown table at the cursor or replaces the current selection.
 * It adds line breaks around table when necessary to prevent overlap with surrounding text.
 *
 * @param config - The optional configuration for the command.
 *
 * `config.size` - The optional size of the inserted table. Defaults to `2x2`.
 *
 * @example Add a keyboard shortcut that inserts a `2x2` markdown table.
 * ```typescript
 * import { EditorView, keymap } from "@codemirror/view"
 *
 * import { insertEmptyMarkdownTable } from "codemirror-markdown-tables"
 *
 * // Create key binding that inserts a 2x2 table
 * const insertTableKeyBinding = {
 *   key: "Alt-Mod-t",
 *   run: insertEmptyMarkdownTable(),
 * }
 *
 * // Wrap the key binding inside a keymap and add the extension to CodeMirror
 * new EditorView({
 *   extensions: keymap.of([insertTableKeyBinding]),
 * })
 * ```
 *
 * @example Create a command that inserts a `5x5` markdown table.
 * ```typescript
 * import { insertEmptyMarkdownTable } from "codemirror-markdown-tables"
 *
 * const insertLargeTable = insertEmptyMarkdownTable({ size: { rows: 5, cols: 5 } })
 * ```
 *
 * @throws Error if `size` is specified and `size.rows` and `size.cols` aren't positive integers.
 */
export declare function insertEmptyMarkdownTable(config?: {
    readonly size?: {
        readonly rows: number;
        readonly cols: number;
    };
}): StateCommand;

/**
 * Creates a {@link CompletionSource} that shows an autocomplete menu for creating tables.
 *
 * Defaults to showing options for a `2x2`, `3x3`, and `4x4` table.
 *
 * The autocompleter pops up a menu after typing `|` on an empty line.
 * It displays the given list of table size options, with the first option preselected.
 *
 * @param config - The optional configuration for the autocompleter.
 *
 * `config.options` - The optional list of completions shown in the autocomplete popup.
 * Defaults to `[2x2, 3x3, 4x4]`.
 *
 * @example Add an extension that autocompletes a table after typing `|`.
 * ```typescript
 * import { autocompletion } from "@codemirror/autocomplete"
 * import { markdown, markdownLanguage } from "@codemirror/lang-markdown"
 * import { EditorView } from "@codemirror/view"
 *
 * import { markdownTableAutocompleter } from "codemirror-markdown-tables"
 *
 * // Create markdown language with GitHub-flavored markdown support
 * const markdownLanguageSupport = markdown({ base: markdownLanguage })
 *
 * // Create markdown tables autocomplete extension (merges with other markdown autocomplete extensions)
 * const markdownTableAutocompletion = markdownLanguageSupport.language.data.of({
 *   autocomplete: markdownTableAutocompleter(),
 * })
 *
 * // Add all extensions to CodeMirror
 * new EditorView({
 *   extensions: [autocompletion(), markdownLanguageSupport, markdownTableAutocompletion],
 * })
 * ```
 *
 * @example Create an autocompleter that shows options for `3x3` and `2x2` with `3x3` preselected.
 * ```typescript
 * import { markdownTableAutocompleter } from "codemirror-markdown-tables"
 *
 * const customAutocompleter = markdownTableAutocompleter({
 *   options: [{ rows: 3, cols: 3 }, { rows: 2, cols: 2 }]
 * })
 * ```
 *
 * @throws Error if `config.options` are specified and `rows` and `cols` aren't positive integers.
 */
export declare function markdownTableAutocompleter(config?: {
    readonly options?: readonly {
        readonly rows: number;
        readonly cols: number;
    }[];
}): CompletionSource;

/**
 * Creates an {@link Extension} that turns markdown tables into interactive components.
 *
 * Defaults to the following configuration:
 * ```typescript
 * {
 *   theme: { light: TableTheme.light, dark: TableTheme.dark },
 *   style: TableStyle.default,
 *   selectionType: "codemirror",
 *   handlePosition: "outside",
 *   lineWrapping: "wrap",
 *   markdownConfig: {
 *     extensions: undefined,       // Results in CM MarkdownConfig default: []
 *     completeHTMLTags: undefined, // Results in CM MarkdownConfig default: true
 *     pasteURLAsLink: undefined,   // Results in CM MarkdownConfig default: true
 *     htmlTagLanguage: undefined,  // Results in CM MarkdownConfig default: default html language
 *   },
 *   extensions: [],
 *   globalKeyBindings: [],
 * }
 * ```
 *
 * @param config - The optional configuration for the extension.
 * If specified, properties in this config override properties in the default configuration.
 * Properties that are set to `undefined` or omitted use the default values.
 *
 * @example Register the extension with defaults.
 * ```typescript
 * import { EditorView } from "@codemirror/view"
 *
 * import { markdownTables } from "codemirror-markdown-tables"
 *
 * // Add markdown tables extension to CodeMirror
 * new EditorView({
 *   extensions: [markdownTables()],
 * })
 * ```
 *
 * @example Create a custom extension.
 * ```typescript
 * import { defaultKeymap, historyKeymap } from "@codemirror/commands"
 * import { searchKeymap } from "@codemirror/search"
 * import { highlightSpecialChars, keymap } from "@codemirror/view"
 * import { Autolink, Emoji, Strikethrough, Subscript, Superscript } from "@lezer/markdown"
 *
 * import { markdownTables, TableStyle, TableTheme } from "codemirror-markdown-tables"
 *
 * const customMarkdownTables = markdownTables({
 *   theme: {
 *     light: TableTheme.light,
 *     dark: TableTheme.dark.with({
 *       "--tbl-theme-row-background": "#000",
 *       "--tbl-theme-text-color": "#ccc",
 *       "--tbl-theme-menu-background": "#000",
 *       "--tbl-theme-menu-text-color": "#ccc",
 *     }),
 *   },
 *   style: TableStyle.default.with({
 *     "--tbl-style-font-size": "16px",
 *     "--tbl-style-menu-font-size": "14px",
 *     "--tbl-style-default-header-alignment": "center",
 *   }),
 *   markdownConfig: {
 *     extensions: [Strikethrough, Autolink, Subscript, Superscript, Emoji],
 *   },
 *   extensions: [highlightSpecialChars(), keymap.of(defaultKeymap)],
 *   globalKeyBindings: [...historyKeymap, ...searchKeymap],
 * })
 * ```
 */
export declare function markdownTables(config?: MarkdownTablesConfig): Extension;

/**
 * The optional configuration for the {@link markdownTables} extension.
 *
 * If specified, properties in this config override properties in the default configuration.
 * Properties that are set to `undefined` or omitted take the default values.
 */
export declare interface MarkdownTablesConfig {
    /**
     * Color scheme for the table.
     *
     * When set to a `light` and `dark` theme, the theme adjusts based on the
     * **CodeMirror light and dark mode configuration** (_not_ CSS `prefers-color-scheme`).
     *
     * When set to a _single_ theme, the theme applies in both modes
     * (i.e. `theme: SomeTheme` is equivalent to `theme: { light: SomeTheme, dark: SomeTheme }`).
     *
     * Defaults to `{ light: TableTheme.light, dark: TableTheme.dark }`.
     */
    readonly theme?: TableTheme | {
        readonly light: TableTheme;
        readonly dark: TableTheme;
    } | undefined;
    /**
     * Fonts and other styles for the table.
     *
     * Defaults to `TableStyle.default`.
     */
    readonly style?: TableStyle | undefined;
    /**
     * Text cursor and selection implementation for the table cell editor.
     *
     * When set to `"codemirror"`, the editor uses CodeMirror's implementation.
     * Essentially, the CodeMirror editor _embedded inside cells_ enables the
     * [`drawSelection`](https://codemirror.net/docs/ref/#view.drawSelection) extension along with
     * some CSS that hides the browser's native cursor and selection.
     *
     * When set to `native`, the editor uses the browser's implementation.
     *
     * Specify `native` only if [`drawSelection`](https://codemirror.net/docs/ref/#view.drawSelection) isn't enabled
     * in the _root_ CodeMirror editor (it's enabled by default with `basicSetup` and `minimalSetup`).
     *
     * Defaults to `"codemirror"`.
     */
    readonly selectionType?: "codemirror" | "native" | undefined;
    /**
     * Position of the row and column header grips.
     *
     * When set to `"outside"`, handles appear beyond the top/left edge of the table.
     * This requires a sufficient left margin to keep the table edge aligned with the _root_ CodeMirror editor edge,
     * but it's much easier to click and drag the handles, especially on mobile.
     *
     * When set to `"inside"`, handles appear on the top/left table border itself.
     * This requires no extra left margin, but it's difficult to click and drag the handles, especially on mobile.
     *
     * Defaults to `"outside"`
     */
    readonly handlePosition?: "outside" | "inside" | undefined;
    /**
     * Wrapping mode of the table.
     *
     * When set to `"wrap"`, wraps long table cell text.
     * Essentially, the CodeMirror editor _embedded inside cells_ enables the
     * [`lineWrapping`](https://codemirror.net/docs/ref/#view.EditorView^lineWrapping) extension
     * along with the CSS `"word-break": "normal", "overflow-wrap": "break-word"`.
     *
     * When set to `"nowrap"`, the editor does _not_ wrap long table cell text.
     * The editor sets the CSS to `white-space: "pre"`.
     *
     * Defaults to `"wrap"`.
     */
    readonly lineWrapping?: "wrap" | "nowrap" | undefined;
    /**
     * Extensions for the table cell editor.
     *
     * The CodeMirror editor _embedded inside cells_ (not the _root_ CodeMirror editor) enables the given extensions.
     *
     * The table cell editor doesn't automatically inherit _root_ CodeMirror editor extensions.
     * Instead, specify basic editor extensions like
     * [`highlightWhitespace`](https://codemirror.net/docs/ref/#view.highlightWhitespace)
     * here to enable them inside cells.
     *
     * Keyboard shortcuts specified here execute actions on the CodeMirror editor _embedded inside cells_,
     * rather than the _root_ CodeMirror editor.
     * They operate on the text _inside the cell_ in isolation, rather than the text of the document _as a whole_.
     *
     * Specify KeyBindings from [`defaultKeymap`](https://codemirror.net/docs/ref/#commands.defaultKeymap) or similar here
     * to enable basic shortcuts inside the cell editor.
     * [`defaultKeymap`](https://codemirror.net/docs/ref/#commands.defaultKeymap) defines shortcuts like
     * <kbd>Ctrl+A</kbd>/<kbd>Ctrl+A</kbd> which should select all the _cell_ text rather than all the _document_ text.
     *
     * Conversely, specify KeyBindings from [`historyKeymap`](https://codemirror.net/docs/ref/#commands.historyKeymap)
     * and [`searchKeymap`](https://codemirror.net/docs/ref/#search.searchKeymap) in {@link globalKeyBindings} instead,
     * since these keyboard shortcuts operate on the _root_ CodeMirror editor and the document _as a whole_.
     *
     * Defaults to `[]`.
     */
    readonly extensions?: readonly Extension[] | undefined;
    /**
     * Markdown language configuration for the table cell editor.
     *
     * The CodeMirror _editor embedded inside cells_ calls the
     * [`markdown()` function in `@codemirror/lang-markdown`](https://github.com/codemirror/lang-markdown?tab=readme-ov-file#user-content-markdown)
     * with the specified options.
     *
     * The table cell editor doesn't automatically inherit the _root_ CodeMirror markdown language configuration.
     *
     * [See `@codemirror/lang-markdown` for descriptions](https://github.com/codemirror/lang-markdown?tab=readme-ov-file#user-content-markdown^config).
     *
     * Defaults to `{}`.
     */
    readonly markdownConfig?: {
        /**
         * [See `@codemirror/lang-markdown`](https://github.com/codemirror/lang-markdown?tab=readme-ov-file#user-content-markdown^config.extensions).
         */
        extensions?: MarkdownExtension;
        /**
         * [See `@codemirror/lang-markdown`](https://github.com/codemirror/lang-markdown?tab=readme-ov-file#user-content-markdown^config.completehtmltags).
         */
        completeHTMLTags?: boolean;
        /**
         * [See `@codemirror/lang-markdown`](https://github.com/codemirror/lang-markdown?tab=readme-ov-file#user-content-markdown^config.pasteurlaslink).
         */
        pasteURLAsLink?: boolean;
        /**
         * [See `@codemirror/lang-markdown`](https://github.com/codemirror/lang-markdown?tab=readme-ov-file#user-content-markdown^config.htmltaglanguage).
         */
        htmlTagLanguage?: LanguageSupport;
    };
    /**
     * Keyboard shortcuts for the table cell editor that delegate to the _root_ CodeMirror editor.
     *
     * Keyboard shortcuts specified here execute actions on the _root_ CodeMirror editor,
     * rather than the CodeMirror editor _embedded inside cells_.
     * They operate on the text of the document _as a whole_, rather than the text _inside the cell_ in isolation.
     *
     * Specify KeyBindings from [`historyKeymap`](https://codemirror.net/docs/ref/#commands.historyKeymap)
     * or similar here to enable history shortcuts while inside the cell editor.
     * [`historyKeymap`](https://codemirror.net/docs/ref/#commands.historyKeymap) defines keyboard shortcuts like
     * <kbd>Ctrl+Z</kbd>/<kbd>Cmd+Z</kbd> which should undo across the _document_ text rather than just the _cell_ text.
     * Another example is [`searchKeymap`](https://codemirror.net/docs/ref/#search.searchKeymap) which defines
     * keyboard shortcuts that should search across the entire _document_ text rather than just the _cell_ text.
     *
     * Conversely, specify KeyBindings from [`defaultKeymap`](https://codemirror.net/docs/ref/#commands.defaultKeymap)
     * in {@link extensions} instead, since these keyboard shortcuts operate on the CodeMirror editor
     * _embedded inside cells_ and the text _inside the cell_ in isolation.
     *
     * Defaults to `[]`.
     */
    readonly globalKeyBindings?: readonly KeyBinding[] | undefined;
}

/**
 * Properties that define font and other CSS styles.
 *
 * Style properties correspond directly to CSS variables of the same name defined in `:root` scope.
 * Create custom styles in code or override style properties in CSS.
 *
 * @example In code
 * ```typescript
 * import { TableStyle } from "codemirror-markdown-tables"
 *
 * const customStyle = TableStyle.default.with({
 *   "--tbl-style-font-family": '"Comic Sans", sans-serif',
 *   "--tbl-style-font-size": "16px",
 * })
 * ```
 *
 * @example In CSS
 * ```css
 * :root {
 *   --tbl-style-font-family: "Comic Sans, sans-serif";
 *   --tbl-style-font-size: 16px;
 * }
 * ```
 */
export declare class TableStyle {
    /**
     * Basic style with sensible defaults.
     */
    static readonly default: TableStyle;
    /**
     * Properties that define font and other CSS styles.
     */
    readonly props: Defined<TableStyleProps>;
    /**
     * Returns a copy of this {@link TableStyle} with the given {@link props} applied.
     *
     * @param props - The optional property changes to apply to the copy.
     * If specified, props override properties in the original {@link TableStyle}.
     * Properties that are set to `undefined` or omitted use the original values.
     *
     * @example
     * ```typescript
     * const customStyle = TableStyle.default.with({
     *   "--tbl-style-font-family": '"Comic Sans", sans-serif',
     *   "--tbl-style-font-size": "16px",
     * })
     * ```
     */
    with(props?: TableStyleProps): TableStyle;
    private static of;
    private constructor();
}

/**
 * Properties that define font and other CSS styles.
 *
 * Style properties correspond directly to CSS variables of the same name defined in `:root` scope.
 * Create custom styles in code or override style properties in CSS.
 *
 * @example In code
 * ```typescript
 * import { TableStyle } from "codemirror-markdown-tables"
 *
 * const customStyle = TableStyle.default.with({
 *   "--tbl-style-font-family": '"Comic Sans", sans-serif',
 *   "--tbl-style-font-size": "16px",
 * })
 * ```
 *
 * @example In CSS
 * ```css
 * :root {
 *   --tbl-style-font-family: "Comic Sans, sans-serif";
 *   --tbl-style-font-size: 16px;
 * }
 * ```
 */
export declare interface TableStyleProps {
    /**
     * Font family of text (CSS `font-family`).
     * @example '"Comic Sans"'
     */
    "--tbl-style-font-family"?: string | undefined;
    /**
     * Font size of text (CSS `font-size`).
     * @example "16px"
     */
    "--tbl-style-font-size"?: string | undefined;
    /**
     * Font family of menu item text (CSS `font-family`).
     * @example '"Comic Sans"'
     */
    "--tbl-style-menu-font-family"?: string | undefined;
    /**
     * Font size of menu item text (CSS `font-size`).
     * @example "16px"
     */
    "--tbl-style-menu-font-size"?: string | undefined;
    /**
     * Alignment of text in header cell when its column is otherwise unaligned.
     * @example "left"
     */
    "--tbl-style-default-header-alignment"?: "left" | "center" | "right" | undefined;
}

/**
 * Properties that define the CSS color scheme.
 *
 * Theme properties correspond directly to CSS variables of the same name defined in `:root` scope.
 * Create custom styles in code or override style properties in CSS.
 *
 * @example In code
 * ```typescript
 * import { TableTheme } from "codemirror-markdown-tables"
 *
 * const customDarkTheme = TableTheme.dark.with({
 *   "--tbl-theme-header-row-background": "gray",
 *   "--tbl-theme-outline-color": "green",
 * })
 * ```
 *
 * @example in CSS
 * ```css
 * :root {
 *   --tbl-theme-header-row-background: gray;
 *   --tbl-theme-outline-color: green;
 * }
 * ```
 */
export declare class TableTheme {
    /**
     * Basic light theme that works well with the CodeMirror default theme.
     */
    static readonly light: TableTheme;
    /**
     * Basic dark theme.
     */
    static readonly dark: TableTheme;
    /**
     * Theme based on table colors in GitHub's light theme.
     */
    static readonly githubLight: TableTheme;
    /**
     * Theme based on table colors in GitHub's dark theme.
     */
    static readonly githubDark: TableTheme;
    /**
     * Theme based on table colors in GitHub's soft dark theme.
     */
    static readonly githubSoftDark: TableTheme;
    /**
     * Dark theme that works well with
     * [`@codemirror/theme-one-dark`](https://github.com/codemirror/theme-one-dark).
     */
    static readonly oneDark: TableTheme;
    /**
     * Properties that define the CSS color scheme.
     */
    readonly props: Defined<TableThemeProps>;
    /**
     * Returns a copy of this {@link TableTheme} with the given {@link props} applied.
     *
     * @param props - The optional property changes to apply to the copy.
     * If specified, props override properties in the original {@link TableTheme}.
     * Properties that are set to `undefined` or omitted use the original values.
     *
     * @example
     * ```typescript
     * const customDarkTheme = TableTheme.dark.with({
     *   "--tbl-theme-header-row-background": "gray",
     *   "--tbl-theme-outline-color": "green",
     * })
     * ```
     */
    with(props?: TableThemeProps): TableTheme;
    private static of;
    private constructor();
}

/**
 * Properties that define the CSS color scheme.
 *
 * Theme properties correspond directly to CSS variables of the same name defined in `:root` scope.
 * Create custom styles in code or override style properties in CSS.
 *
 * @example In code
 * ```typescript
 * import { TableTheme } from "codemirror-markdown-tables"
 *
 * const customDarkTheme = TableTheme.dark.with({
 *   "--tbl-theme-header-row-background": "gray",
 *   "--tbl-theme-outline-color": "green",
 * })
 * ```
 *
 * @example in CSS
 * ```css
 * :root {
 *   --tbl-theme-header-row-background: gray;
 *   --tbl-theme-outline-color: green;
 * }
 * ```
 */
export declare interface TableThemeProps {
    /**
     * Background color of all cells, unless overriden by
     * other `*-row-background` properties (CSS `color`).
     * @example "#ffffff"
     */
    "--tbl-theme-row-background"?: string | undefined;
    /**
     * Background color of the cells in the header row.
     * @example "#ffffff"
     */
    "--tbl-theme-header-row-background"?: string | undefined;
    /**
     * Background color of the cells in even rows.
     * @example "#ffffff"
     */
    "--tbl-theme-even-row-background"?: string | undefined;
    /**
     * Background color of the cells in odd rows.
     * @example "#ffffff"
     */
    "--tbl-theme-odd-row-background"?: string | undefined;
    /**
     * Color of borders.
     * @example "#ffffff"
     */
    "--tbl-theme-border-color"?: string | undefined;
    /**
     * Color of hovered border.
     * @example "#ffffff"
     */
    "--tbl-theme-border-hover-color"?: string | undefined;
    /**
     * Color of clicked border.
     * @example "#ffffff"
     */
    "--tbl-theme-border-active-color"?: string | undefined;
    /**
     * Color of the outline around selected cells.
     * @example "#ffffff"
     */
    "--tbl-theme-outline-color"?: string | undefined;
    /**
     * Color of text.
     * @example "#ffffff"
     */
    "--tbl-theme-text-color"?: string | undefined;
    /**
     * Color of menu borders.
     * @example "#ffffff"
     */
    "--tbl-theme-menu-border-color"?: string | undefined;
    /**
     * Background color of menu items.
     * @example "#ffffff"
     */
    "--tbl-theme-menu-background"?: string | undefined;
    /**
     * Background color of a hovered menu item.
     * @example "#ffffff"
     */
    "--tbl-theme-menu-hover-background"?: string | undefined;
    /**
     * Color of menu item text.
     * @example "#ffffff"
     */
    "--tbl-theme-menu-text-color"?: string | undefined;
    /**
     * Color of hovered menu item text.
     * @example "#ffffff"
     */
    "--tbl-theme-menu-hover-text-color"?: string | undefined;
    /**
     * Color of the layer overlaid on table when a <kbd>Select All</kbd> takes place and the editor
     * has focus.
     *
     * The overlay shows as an alpha layer _above the table_ whereas CodeMirror places its default
     * selection background _behind editor text_.
     * So specify an alpha overlay color that, when mixed with the table background color,
     * mimics the opaque CodeMirror selection background color.
     *
     * @example
     * ```typescript
     * // Alpha equivalent of CodeMirror's default focus selection background color on a white bg
     * "rgb(20 2 167 / 17%)"
     * ```
     */
    "--tbl-theme-select-all-focus-overlay"?: string | undefined;
    /**
     * Color of the layer overlaid on table when a <kbd>Select All</kbd> takes place and the editor
     * _doesn't_ have focus.
     *
     * The overlay shows as an alpha layer _above the table_ whereas CodeMirror places its default
     * selection background _behind editor text_.
     * So specify an alpha overlay color that, when mixed with the table background color,
     * mimics the opaque CodeMirror selection background color.
     *
     * @example
     * ```typescript
     * // Alpha equivalent of CodeMirror's default blur selection background color on a white bg
     * "rgb(2 2 2 / 15%)"
     * ```
     */
    "--tbl-theme-select-all-blur-overlay"?: string | undefined;
}

export { }
