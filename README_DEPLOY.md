# Ride Book Karo live deploy

This repo is configured for Firebase Hosting with project `ride-book-karo-e83fd`.

## Deploy commands

```bash
npm install -g firebase-tools
firebase login
firebase deploy --only hosting,firestore:rules
