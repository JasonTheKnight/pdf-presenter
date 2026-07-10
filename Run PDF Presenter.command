#!/bin/sh
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$APP_DIR" || exit 1

if [ ! -d "node_modules" ]; then
  echo "Dependencies are not installed yet. Run npm install in this folder first."
  read -r -p "Press Return to close..."
  exit 1
fi

npm start
