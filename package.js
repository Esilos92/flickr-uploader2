{
  "name": "flickr-photo-uploader",
  "version": "1.0.0",
  "description": "Production-ready Flickr photo uploader with rate limiting, error handling, and privacy controls",
  "main": "index.js",
  "type": "module",
  "engines": {
    "node": "22.x"
  },
  "scripts": {
    "start": "node index.js",
    "test": "echo \"Add tests here\" && exit 0",
    "dev": "vercel dev",
    "deploy": "vercel --prod"
  },
  "dependencies": {
    "express": "^4.18.2",
    "multer": "^1.4.5-lts.1",
    "flickr-sdk": "^7.0.0-beta.9"
  },
  "keywords": [
    "flickr",
    "photo",
    "upload",
    "api",
    "vercel",
    "serverless",
    "privacy",
    "dropbox"
  ],
  "author": "Your Name",
  "license": "MIT"
}
