#!/bin/bash

# Kill any process using port 4173
lsof -ti:4173 | xargs -r kill -9 || true

# Wait a moment for port to be released
sleep 1

# Start dev server on port 4173
npm run dev -- --host 0.0.0.0 --port 4173
