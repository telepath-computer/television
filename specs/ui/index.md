*UI policy authority: cross-cutting requirements shared by every Television surface and browser-facing behavior.*

# UI policy

## Browser compatibility

Markup, CSS, and browser script APIs used by Television must rely on well-established web-platform features that function across Chromium, Firefox, and WebKit. A surface or browser-facing behavior may depend on a feature outside that baseline only when the dependency is essential. The spec that owns the surface, element, or behavior must name the feature, grant the exception, and explain why the dependency is essential.
