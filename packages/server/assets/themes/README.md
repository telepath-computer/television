# Bundled themes

Each immediate child directory is an installed-theme package with `manifest.json`, `theme.css`, and any relative assets it needs. The server build validates this tree and copies it into the server and CLI distributions.

A serving boot copies each package into the user themes directory once. The installed folder then belongs to the user. The null theme is labelled `None` and has no package in this tree. Clouds is the default theme selected on a new installation.
