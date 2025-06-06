const { createFlickr } = require('flickr-sdk');
const { tmpdir } = require('os');
const { join, parse } = require('path');
const { writeFile, unlink } = require('fs/promises');

// Initialize Flickr SDK following EXACT official quickstart pattern
let flickr, upload, isConfigured = false;

try {
  if (process.env.FLICKR_API_KEY && process.env.FLICKR_API_SECRET) {
    // OAuth 1.0 method - EXACT pattern from official docs
    const { flickr: flickrClient, upload: uploadClient } = createFlickr({
      consumerKey: process.env.FLICKR_API_KEY,
      consumerSecret: process.env.FLICKR_API_SECRET,
      oauthToken: process.env.FLICKR_ACCESS_TOKEN,
      oauthTokenSecret: process.env.FLICKR_ACCESS_SECRET,
    });
    
    flickr = flickrClient;
    upload = uploadClient;
    isConfigured = true;
    console.log('Flickr SDK initialized with OAuth 1.0');
  }
} catch (error) {
  console.error('Flickr SDK initialization failed:', error);
}

const userId = process.env.FLICKR_USER_ID;

// Rate limiting per Flickr API docs: 3600 queries per hour
const RATE_LIMIT = {
  maxRequests: 3600,
  windowMs: 60 * 60 * 1000,
  requests: [],
};

function checkRateLimit() {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT.windowMs;
  
  RATE_LIMIT.requests = RATE_LIMIT.requests.filter(time => time > windowStart);
  
  if (RATE_LIMIT.requests.length >= RATE_LIMIT.maxRequests) {
    throw new Error('Rate limit exceeded. Flickr allows 3600 requests per hour.');
  }
  
  RATE_LIMIT.requests.push(now);
}

// Retry logic for API reliability
async function retryWithBackoff(operation, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error.message);
      
      if (error.message.includes('Invalid OAuth') || 
          error.message.includes('Invalid API key') ||
          error.message.includes('Permission denied')) {
        throw error;
      }
      
      if (attempt === maxAttempts) {
        throw new Error(`Operation failed after ${maxAttempts} attempts: ${error.message}`);
      }
      
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Get albums - following official API call pattern
async function getAlbums() {
  try {
    checkRateLimit();
    
    // EXACT pattern: await flickr("method.name", { params })
    const res = await retryWithBackoff(async () => {
      return await flickr("flickr.photosets.getList", { 
        user_id: userId 
      });
    });
    
    if (!res.photosets || !res.photosets.photoset) {
      return [];
    }
    
    return res.photosets.photoset.map((set) => ({
      id: set.id,
      title: set.title._content,
    }));
    
  } catch (error) {
    console.error('Error getting albums:', error);
    return [];
  }
}

// Album management with duplicate prevention
async function findOrCreateAlbum(albumTitle, primaryPhotoId) {
  try {
    const albums = await getAlbums();
    
    // Case-insensitive search for existing album
    const existingAlbum = albums.find((a) => 
      a.title.toLowerCase().trim() === albumTitle.toLowerCase().trim()
    );

    if (existingAlbum) {
      console.log(`Found existing album: "${albumTitle}" (ID: ${existingAlbum.id})`);
      return existingAlbum.id;
    }

    console.log(`Creating new private album: "${albumTitle}"`);
    
    checkRateLimit();
    
    // EXACT pattern: await flickr("method.name", { params })
    const res = await retryWithBackoff(async () => {
      return await flickr("flickr.photosets.create", {
        title: albumTitle,
        primary_photo_id: primaryPhotoId,
        description: `Private album: ${albumTitle}`,
      });
    });

    console.log(`Created album: "${albumTitle}" (ID: ${res.photoset.id})`);
    return res.photoset.id;
    
  } catch (error) {
    console.error('Album operation failed:', error);
    throw new Error(`Album operation failed: ${error.message}`);
  }
}

// Photo upload following EXACT official upload pattern
async function uploadPhotoFromUrl(imageUrl, title, albumTitle) {
  let tempFilePath = null;
  
  try {
    console.log(`Downloading image from: ${imageUrl}`);
    
    // Download with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    
    const response = await fetch(imageUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Flickr-Uploader/1.0' }
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }
    
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.startsWith('image/')) {
      throw new Error(`Invalid content type: ${contentType}. Expected image.`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    if (buffer.length === 0) {
      throw new Error('Downloaded file is empty');
    }
    
    if (buffer.length > 200 * 1024 * 1024) {
      throw new Error('File too large. Maximum size is 200MB.');
    }

    // Save to temp file for upload
    const fileName = title.endsWith('.jpg') ? title : `${title}.jpg`;
    tempFilePath = join(tmpdir(), `flickr_${Date.now()}_${fileName}`);
    await writeFile(tempFilePath, buffer);
    
    console.log(`File saved temporarily: ${tempFilePath} (${buffer.length} bytes)`);

    // Upload using EXACT official pattern: await upload(filePath, options)
    console.log(`Uploading photo: "${title}"`);
    
    const photoId = await retryWithBackoff(async () => {
      return await upload(tempFilePath, {
        title: title,
        description: `Uploaded via API on ${new Date().toISOString()}`,
        is_public: 0,  // Private per requirements
        is_friend: 0,  // Not visible to friends
        is_family: 0,  // Not visible to family
        hidden: 2,     // Hide from public searches
      });
    });
    
    console.log(`Photo uploaded successfully (ID: ${photoId})`);

    // Handle album assignment
    const albumId = await findOrCreateAlbum(albumTitle, photoId);
    
    // Add to existing album using official API call pattern
    const albums = await getAlbums();
    const albumExisted = albums.some(a => a.id === albumId);
    
    if (albumExisted) {
      try {
        checkRateLimit();
        
        // EXACT pattern: await flickr("method.name", { params })
        await retryWithBackoff(async () => {
          return await flickr("flickr.photosets.addPhoto", {
            photoset_id: albumId,
            photo_id: photoId,
          });
        });
        
        console.log(`Photo added to existing album: ${albumTitle}`);
      } catch (addError) {
        console.warn(`Could not add photo to album: ${addError.message}`);
      }
    }

    return { 
      success: true, 
      photoId, 
      albumId,
      albumTitle,
      isPrivate: true,
      uploadedAt: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('Upload failed:', error);
    throw error;
  } finally {
    // Clean up temp file
    if (tempFilePath) {
      try {
        await unlink(tempFilePath);
        console.log('Temporary file cleaned up');
      } catch (cleanupError) {
        console.warn('Failed to clean up temp file:', cleanupError.message);
      }
    }
  }
}

// Environment validation
function validateEnvironment() {
  const required = [
    'FLICKR_API_KEY',
    'FLICKR_API_SECRET', 
    'FLICKR_ACCESS_TOKEN',
    'FLICKR_ACCESS_SECRET',
    'FLICKR_USER_ID'
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  
  if (!isConfigured) {
    throw new Error('Flickr SDK failed to initialize');
  }
}

// Main Vercel function handler
module.exports = async (req, res) => {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Health check
  if (req.method === 'GET') {
    try {
      validateEnvironment();
      
      return res.status(200).json({
        status: '🎉 FLICKR UPLOADER LIVE!',
        message: 'Following Official flickr-sdk Documentation',
        service: 'Flickr Photo Uploader',
        version: '1.0.0',
        deployment: 'SUCCESS ✅',
        configured: '✅ READY',
        implementation: {
          sdk: 'flickr-sdk v7.0.0-beta.9',
          pattern: 'Official Quickstart',
          auth: 'OAuth 1.0',
          methods: [
            'flickr("flickr.photosets.getList", params)',
            'flickr("flickr.photosets.create", params)', 
            'flickr("flickr.photosets.addPhoto", params)',
            'upload(filePath, options)'
          ]
        },
        features: [
          '📸 Private photo uploads via official upload() method',
          '📁 Smart album management with duplicate prevention', 
          '🔒 Rate limiting (3600 requests/hour)',
          '⚡ Optimized for Make.com integration',
          '🛡️ Retry logic with exponential backoff'
        ],
        endpoints: {
          health: 'GET /api',
          upload: 'POST /api'
        },
        timestamp: new Date().toISOString(),
        rateLimit: {
          remaining: Math.max(0, RATE_LIMIT.maxRequests - RATE_LIMIT.requests.length),
          total: RATE_LIMIT.maxRequests,
          resetTime: new Date(Date.now() + RATE_LIMIT.windowMs).toISOString()
        }
      });
    } catch (error) {
      return res.status(200).json({
        status: '⚠️ DEPLOYED BUT NOT CONFIGURED',
        message: 'App deployed successfully but missing Flickr API credentials',
        service: 'Flickr Photo Uploader',
        version: '1.0.0',
        deployment: 'SUCCESS ✅',
        configured: '❌ MISSING ENV VARS',
        error: error.message,
        timestamp: new Date().toISOString(),
        action: 'Add Flickr API credentials to Vercel environment variables',
        needed: [
          'FLICKR_API_KEY (your API key)',
          'FLICKR_API_SECRET (your API secret)',
          'FLICKR_ACCESS_TOKEN (oauth token)', 
          'FLICKR_ACCESS_SECRET (oauth token secret)',
          'FLICKR_USER_ID (your Flickr user ID)'
        ],
        setup: {
          flickrApp: 'https://www.flickr.com/services/apps/create/',
          oauth: 'https://www.flickr.com/services/api/auth.oauth.html',
          quickstart: 'https://www.npmjs.com/package/flickr-sdk'
        }
      });
    }
  }

  // Upload endpoint
  if (req.method === 'POST') {
    const startTime = Date.now();
    
    try {
      validateEnvironment();
      
      const { imageUrl, dropboxUrl, albumPath, title, description } = req.body;

      const sourceUrl = dropboxUrl || imageUrl;
      if (!sourceUrl) {
        return res.status(400).json({ 
          error: 'Missing required field: imageUrl or dropboxUrl',
          timestamp: new Date().toISOString()
        });
      }
      
      if (!albumPath) {
        return res.status(400).json({ 
          error: 'Missing required field: albumPath (format: "Event/Album")',
          timestamp: new Date().toISOString()
        });
      }

      // Validate URL
      try {
        new URL(sourceUrl);
      } catch {
        return res.status(400).json({ 
          error: 'Invalid URL format',
          timestamp: new Date().toISOString()
        });
      }

      // Parse album path (your original format)
      const parts = albumPath.split('/').filter(Boolean);
      if (parts.length === 0) {
        return res.status(400).json({ 
          error: 'Invalid albumPath format. Expected: "Event/Album"',
          timestamp: new Date().toISOString()
        });
      }
      
      const eventName = parts[0] || 'Uncategorized Event';
      const albumName = parts[1] || 'General';
      const albumTitle = `${eventName} -- ${albumName}`;

      const photoTitle = title || parse(sourceUrl).name || `Photo_${Date.now()}`;
      
      console.log(`Processing upload: ${photoTitle} -> ${albumTitle}`);

      // Perform Flickr upload using official patterns
      const result = await uploadPhotoFromUrl(sourceUrl, photoTitle, albumTitle);
      
      const duration = Date.now() - startTime;
      console.log(`Upload completed in ${duration}ms`);

      // Return success in your original format
      res.status(200).json({
        message: 'Photo uploaded successfully',
        result: {
          ...result,
          duration: `${duration}ms`,
          flickrUrl: `https://www.flickr.com/photos/${userId}/${result.photoId}`,
          albumUrl: result.albumId ? `https://www.flickr.com/photos/${userId}/albums/${result.albumId}` : null,
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`Upload failed after ${duration}ms:`, error);
      
      let statusCode = 500;
      if (error.message.includes('Rate limit exceeded')) {
        statusCode = 429;
      } else if (error.message.includes('Invalid') || error.message.includes('Missing')) {
        statusCode = 400;
      } else if (error.message.includes('Permission denied') || error.message.includes('OAuth')) {
        statusCode = 401;
      }
      
      res.status(statusCode).json({
        error: error.message,
        duration: `${duration}ms`,
        timestamp: new Date().toISOString(),
        requestId: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      });
    }
  } else {
    res.status(405).json({ 
      error: 'Method not allowed. Use GET for health check or POST for upload.',
      timestamp: new Date().toISOString()
    });
  }
};
