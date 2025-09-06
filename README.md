# Commstem-hack

An image-editing playground combining a Next.js client with a Flask server. Users can create a conversation from a base image, upload a boxed/annotated variant plus a global prompt, and the server will generate up to four edited outputs using Google Gemini.

## Features
- Create conversations from an uploaded base image
- Upload original and modified (boxed) images to request edits
- Generate 4 variants via Gemini and browse selections
- Static serving of stored images and outputs

## Requirements
- macOS/Linux/Windows
- Python 3.10+ (virtualenv recommended)
- Node.js 18+ and pnpm (or npm)
- A Google Gemini API key

## Quick Start

1) Clone and enter the project directory
```bash
git clone <this-repo-url>
cd Commstem-hack
```

2) Server setup (Python virtual environment)
```bash
python3 -m venv venv
source venv/bin/activate   # Windows: venv\\Scripts\\activate
pip install -r requirements.txt
```

3) Configure environment
```bash
cp example.env .env
# Edit .env and set GEMINI_API_KEY=<your_key>
```

4) Initialize and run the Flask server
```bash
# Optional: clean storage (outputs, modified, originals) and reset DB
make clean

# Start the server (default http://127.0.0.1:5000)
python3 server/app.py
```

5) Client setup and run (in a new terminal)
```bash
cd client
pnpm install  # or npm install / yarn
pnpm dev      # or npm run dev / yarn dev
# Next dev runs at http://localhost:3000
```

## Environment
Create a `.env` in the project root with:
```
GEMINI_API_KEY=your_api_key_here
```
The server reads this in `server/services/model.py` via `python-dotenv`.

## Project Structure
```
client/           # Next.js 14 app
server/           # Flask app
  routes/         # API blueprints
  services/       # model + storage helpers
  storage/        # sqlite DB + image files
    originals/
    modified/
    outputs/
  app.py          # Flask app factory + runner
requirements.txt  # Python deps
example.env       # Environment template
```

## Running Notes
- The SQLite database lives at `server/storage/app.db` and is created automatically on first run.
- All stored images are under `server/storage/*`. The `make clean` target wipes these folders and the DB file.
- The server enables CORS by default.

## API Overview

Base URL: `http://127.0.0.1:5000`

- GET `/images/<image_id>`
  - Returns the image bytes for a stored image id (PNG).

- GET `/server/storage/<path>`
  - Serves files from `server/storage/*` directories.

- POST `/conversations`
  - multipart/form-data
    - `image` (file, required): base image without boxes
    - `title` (string, optional)
  - Response: `{ id, title, current_image: { id, url } }`

- POST `/conversations/<cid>/edits`
  - multipart/form-data
    - `original` (file, required): original/base image
    - `modified` (file, required): boxed image (edit target)
    - `prompt`   (string, required): global directive
  - Behavior: saves inputs, calls Gemini to produce up to 4 outputs, stores them, logs messages
  - Response: `{ outputs: [{ image_id, url }*4] }`

- POST `/conversations/<cid>/select`
  - application/json: `{ "selected_image_id": number | null }`
  - Sets current image when a valid id is provided; `null` records a deselection.
  - Response: `{ current_image: { id, url }, selected }`

- GET `/conversations`
  - Returns list of conversations: `[{ id, title }]`

- GET `/conversations/<cid>`
  - Returns conversation details with current image and message history.

- PUT `/conversations/<cid>`
  - application/json: `{ "title": string }`
  - Updates conversation title.

## Client Usage
- Start the Next.js dev server: `pnpm dev` in `client/`
- Open `http://localhost:3000`
- Use the UI to upload images, enter a directive, and iterate on edits.

## Troubleshooting
- Missing API key: ensure `.env` is present at repo root and `GEMINI_API_KEY` is set.
- HTTP 500 from model calls: check your key, network access, or Gemini quota.
- CORS/404 on images: confirm server is running and images exist in `server/storage`.
- Clean slate: run `make clean` and restart the server.

## License
MIT or project’s chosen license.

