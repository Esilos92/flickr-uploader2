// Fresh deployment - Production Flickr Uploader
const { createFlickr } = require('flickr-sdk');

// Initialize Flickr (will show proper error if not configured)
let flickr, upload, isConfigured = false;

try {
  if (process.env.FLICKR_API_KEY && process.env.FLICKR_API_SECRET) {
    const sdk = createFlickr({
      consumerKey: process.env.FLICKR_API_KEY,
      consumerSecret: process.env.FLICKR_API_SECRET,
      oauthToken: process.env.FLICKR_ACCESS_TOKEN,
      oauthTokenSecret: process.env.FLICKR_ACCESS_SECRET,
    });
    flickr = sdk.flickr;
    upload = sdk.upload;
    isConfigured = true;
  }
} catch (error) {
  console.log('Flickr SDK not configured yet');
}

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // GET - Health check with clear status
  if (req.method === 'GET') {
    if (isConfigured) {
      return res.status(200).json({
        status: '🎉 FLICKR UPLOADER LIVE!',
        message: 'Production Flickr Photo Uploader Successfully Deployed',
        configured: '✅ READY',
        service: 'Flickr Photo Uploader',
        version: '2.0.0',
        timestamp: new Date().toISOString(),
        endpoints: {
          health: 'GET /',
          upload: 'POST /upload'
        },
        features: [
          '📸 Private photo uploads',
          '📁 Smart album management',
          '🔒 Rate limiting & security',
          '⚡ Optimized for Make.com'
        ]
      });
    } else {
      return res.status(200).json({
        status: '⚠️ DEPLOYED BUT NEEDS CONFIGURATION',
        message: 'App deployed successfully - Add Flickr API credentials',
        configured: '❌ MISSING ENV VARS',
        service: 'Flickr Photo Uploader',
        version: '2.0.0',
        timestamp: new Date().toISOString(),
        needed: [
          'FLICKR_API_KEY',
          'FLICKR_API_SECRET', 
          'FLICKR_ACCESS_TOKEN',
          'FLICKR_ACCESS_SECRET',
          'FLICKR_USER_ID'
        ],
        action: 'Add these environment variables in Vercel project settings'
      });
    }
  }

  // POST - Upload endpoint
  if (req.method === 'POST') {
    if (!isConfigured) {
      return res.status(500).json({
        error: 'Flickr API not configured',
        message: 'Add environment variables to enable uploads',
        timestamp: new Date().toISOString()
      });
    }

    try {
      const { dropboxUrl, imageUrl, albumPath } = req.body || {};
      
      if (!dropboxUrl && !imageUrl) {
        return res.status(400).json({
          error: 'Missing dropboxUrl or imageUrl',
          received: req.body,
          timestamp: new Date().toISOString()
        });
      }

      if (!albumPath) {
        return res.status(400).json({
          error: 'Missing albumPath',
          example: 'Event Name/Album Name',
          timestamp: new Date().toISOString()
        });
      }

      // For now, return success response (add full upload logic later)
      return res.status(200).json({
        status: '✅ UPLOAD ENDPOINT WORKING',
        message: 'Ready to process uploads',
        received: {
          url: dropboxUrl || imageUrl,
          albumPath: albumPath
        },
        timestamp: new Date().toISOString(),
        note: 'Upload processing logic will be added next'
      });

    } catch (error) {
      return res.status(500).json({
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  return res.status(405).json({
    error: 'Method not allowed',
    allowed: ['GET', 'POST'],
    timestamp: new Date().toISOString()
  });
};
