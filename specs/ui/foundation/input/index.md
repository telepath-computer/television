*UI spec: text inputs and textareas — shared text-entry styling in the application and artifacts.*

# Input (UI)

This shared stylesheet applies in the application and live canonical artifact documents.

This spec owns the ambient styling of native text-entry controls in [styles.css](./styles.css). It applies to `textarea` and `input` with no type, an empty type, or type `text`, `email`, `url`, `tel`, `password` or `number`. Search-field design is deferred. It does not style search inputs, buttons, selects, checkboxes, radios, switches, range, color, date/time or file inputs. Those are separate controls.

## Markup and behavior

Use a native input or textarea with an accessible label. Native editing, selection, keyboard navigation and form behavior remain intact. A placeholder is a hint, not a label. A surface owns its field's label, value, validation and layout; foundation owns its default visual treatment.

Use `disabled` to disable a control and `readonly` to retain selectable, readable contents without editing. Set `aria-invalid="true"` when the application presents a validation error, and associate its error message with `aria-describedby`. Do not mark untouched required fields invalid merely because they are empty.

## Error messages

Use a native paragraph with `class="tv-error"` for an error message. This class is an explicit exception to attribute-based styling hooks. It is shared message styling and may be used outside inputs; it adds no validation, visibility, focus or announcement behavior.

```html
<label for="channel-name">Channel name</label>
<input id="channel-name" aria-invalid="true" aria-describedby="channel-name-error">
<p class="tv-error" id="channel-name-error">Enter a channel name.</p>
```

The foundation automatically applies the invalid border when `aria-invalid="true"` is present. A surface does not add an invalid class or set the border itself. The surface supplies the validation result and message. When it presents an error, it shows the message and adds its ID to `aria-describedby`, preserving any existing hint IDs. When the error clears, it removes `aria-invalid` (or sets it to `false`), removes only the error ID from `aria-describedby`, and removes or hides the message using native `hidden`.

## Styling

[styles.css](./styles.css) defines the shared treatment. Text fields remain readable in both appearances, show keyboard focus and validation errors, and distinguish disabled from read-only controls. Read-only contents remain selectable. Textareas support multiple lines and vertical resizing; native number affordances remain intact.

Channel rename and authentication use these ordinary inputs. A containing surface supplies layout rather than a separate field design.

## Delivery

The stylesheet is part of the complete foundation for the app and live canonical artifacts. Frozen canonical versions remain unchanged. The frameset uses the same foundation composition.

## Testing

Native editing semantics require no replacement implementation or duplicate behavioral tests. Composing surfaces prove their field markup, labels and validation state. Foundation distribution owns coverage that this stylesheet reaches production and live canonical. Per [testing policy](../../../arch/testing-policy.md#^ui-styling-out), visual treatments are assessed in the frameset, not through permanent color or geometry assertions.
