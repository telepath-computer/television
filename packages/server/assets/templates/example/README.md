# Example artifact

The page shows the `message` string from the JSON store. Each artifact has a separate store, even when artifacts share the page files. Use `tv resource json` to change the message. An unwritten store or a value without a string message displays “Hello from a template.”; the page leaves the store unchanged.

Copy or detach before changing page files for only one artifact. Create a copy with `tv create-artifact --template example --copy --channel <channel-id> --no-focus`, or copy the linked folder and repoint an existing artifact with `tv update-artifact --id <artifact-id> --path <copy>` to preserve its ID and store.
