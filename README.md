# ImageHexEditor

Client-side JPEG hex editor / glitch art playground.

This module is designed to be embedded into host sites (such as the `Portfolio`
app) as a Razor Class Library (RCL) under `ImageHexEditor.Web`.

The copy of this project under `Portfolio/ExternalApps/ImageHexEditor` is kept
in sync with this library and is referenced by the host application as an
application part.

## Projects

- `ImageHexEditor.Web` – ASP.NET Core Razor Class Library that exposes the
  `/imagehexeditor` route and a fully client-side JPEG hex editor written in
  TypeScript.


