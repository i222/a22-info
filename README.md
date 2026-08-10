# A22 Info

A desktop application for managing information: items, timers, and reports.

## Installation

1. Make sure you have Node.js 20 or higher installed
2. Clone the repository (if you haven't already):
   ```bash
   git clone <repository-url>
   cd a22-info
   ```
3. Install dependencies:
   ```bash
   npm install
   ```

## Run

```bash
npm run dev
```

The app will open in your browser at `http://localhost:3001`

## Features

### Items
Create entries with custom fields — title, description, tags. Edit, delete, search, and filter by tags.


### Reports
View the state of all items and timers in a convenient table.

## Data Storage

All data is stored in the browser (IndexedDB). Export/import JSON backups when needed.
