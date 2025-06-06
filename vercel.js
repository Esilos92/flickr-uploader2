{
  "version": 2,
  "functions": {
    "index.js": {
      "runtime": "nodejs18.x"
    }
  },
  "routes": [
    {
      "src": "/upload",
      "dest": "/index.js"
    },
    {
      "src": "/",
      "dest": "/index.js"
    },
    {
      "src": "/(.*)",
      "dest": "/index.js"
    }
  ]
}
