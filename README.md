# PDF Presenter

A small Electron desktop app for presenting PDFs with a synchronized presenter view and fullscreen audience view.

## Features

- Open a PDF from the app or `File > Open PDF...`
- Move backward and forward through pages from the presenter window
- Pick a detected screen for fullscreen presentation
- Keep the presenter PDF on its original screen while the presentation runs elsewhere
- Stop the fullscreen presentation from the presenter window

## Run

```sh
npm install
npm start
```

## Notes

This is portable across Electron-supported desktop platforms. It was designed with macOS in mind, but the same code path should work on Windows and Linux.
