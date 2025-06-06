{
  "version": 3,
  "name": "flickr-uploader",
  "functions": {
    "index.js": {
      "runtime": "@vercel/node@3.0.7",
      "maxDuration": 60,
      "memory": 1024
    }
  },
  "routes": [
    {
      "src": "/upload",
      "methods": ["POST"],
      "dest": "/index.js"
    },
    {
      "src": "/health",
      "methods": ["GET"],
      "dest": "/index.js"
    },
    {
      "src": "/",
      "methods": ["GET"],
      "dest": "/index.js"
    }
  ],
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "X-Content-Type-Options",
          "value": "nosniff"
        },
        {
          "key": "X-Frame-Options",
          "value": "DENY"
        },
        {
          "key": "X-XSS-Protection",
          "value": "1; mode=block"
        },
        {
          "key": "Referrer-Policy",
          "value": "strict-origin-when-cross-origin"
        }
      ]
    }
  ]
}
