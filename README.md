# PDF Presenter

A small Electron desktop app for presenting PDFs with a synchronized presenter view and fullscreen audience view.

The app was built for macOS use, but it uses Electron and should be portable to other desktop platforms supported by Electron.

## Features

- Open a PDF from the toolbar or `File > Open PDF...`
- View one PDF page at a time in the presenter window
- Move backward and forward through pages with toolbar buttons or keyboard shortcuts
- Render each page to fit the available presenter or presentation window while preserving aspect ratio
- Pick a detected display from the screen dropdown before presenting
- Start a fullscreen presentation window on the selected display
- Keep the presenter window on its original screen while the audience view runs fullscreen elsewhere
- Keep presenter and presentation pages synchronized
- Stop the fullscreen presentation from the presenter window

## Pointer And Annotation Tools

The presenter toolbar includes four slide interaction controls:

- `Pointer`: the default mode. Hover over the PDF in the presenter window to show a semi-transparent red laser pointer. The pointer is mirrored to the fullscreen presentation view at the same relative slide position.
- `Line`: click and drag across the presenter PDF to draw a red line. The laser pointer is hidden while this mode is active.
- `Rectangle`: click and drag across the presenter PDF to draw a red rectangle. The laser pointer is hidden while this mode is active.
- `Clear`: removes all drawn annotations.

Annotations are synchronized to the presentation window and are tied to the page where they were drawn.

## Keyboard Controls

- `ArrowRight`, `PageDown`, or `Space`: next page
- `ArrowLeft` or `PageUp`: previous page
- `Escape`: stop presenting when a fullscreen presentation is active

## Run From Source

```sh
npm install
npm start
```

## Clickable Launchers

This repo includes two macOS launchers:

- `PDF Presenter.app`: double-click to run the app. You can drag this to the Dock or Desktop as a launcher.
- `Run PDF Presenter.command`: double-click to run from Terminal.

Both launchers run this source checkout, so keep `<file path>/pdf-presenter` in place and run `npm install` before using them.
The app bundle includes a custom generated icon stored at `PDF Presenter.app/Contents/Resources/pdf-presenter.icns`; the source PNG is in `assets/pdf-presenter-icon.png`.

## Implementation Notes

- The desktop shell is Electron.
- PDF pages are rendered with PDF.js onto a canvas for reliable one-page-at-a-time display and best-fit scaling.
- PDF metadata and page counts are read with `pdf-lib`.
- Presentation display selection uses Electron's `screen` API.
- Presenter and presentation windows communicate through Electron IPC.

## Author

Jason Knight  
jason@oneknightconsulting.com  
https://www.oneknightconsulting.com

## License

This project is licensed under the GNU Affero General Public License v3.0. See [LICENSE](./LICENSE).
