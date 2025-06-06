{
  "name": "flickr-photo-uploader",
  "version": "1.0.0",
  "description": "Production-ready Flickr photo uploader with rate limiting, error handling, and privacy controls",
  "main": "api/index.js",
  "engines": {
    "node": "22.x"
  },
  "scripts": {
    "start": "node api/index.js",
    "test": "echo \"Add tests here\" && exit 0",
    "dev": "vercel dev",
    "deploy": "vercel --prod"
  },
  "dependencies": {
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
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/yourusername/flickr-uploader.git"
  },
  "bugs": {
    "url": "https://github.com/yourusername/flickr-uploader/issues"
  },
  "homepage": "https://github.com/yourusername/flickr-uploader#readme"
}
