const { createFlickr } = require('flickr-sdk');
const { tmpdir } = require('os');
const { join, parse } = require('path');
const { writeFile, unlink } = require('fs/promises');

// Flickr SDK initialization with error handling
let flickr, upload;
try {
  const flickrSDK = createFlickr({
    consumerKey: process.env.FLICKR_API_KEY,
    consumerSecret: process.env.FLICKR_API_SECRET,
    oauthToken: process.env.FLICKR_ACCESS_TOKEN,
    oauthTokenSecret: process.env.FLICKR_ACCESS_SECRET,
  });
  flickr = flickrSDK.flickr;
  upload = flickrSDK.upload;
} catch (error) {
  console.error('Failed to initialize Flickr SDK:', error);
}

const userId = process.env.FLICKR_USER_ID;

// Rate limiting: Flickr allows 3600 queries per hour
const RATE_LIMIT = {
  maxRequests: 3600,
  windowMs: 60 * 60 * 1000, // 1 hour
  requests: [],
};

// Check rate limit compliance
function checkRateLimit() {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT.windowMs;
  
  // Remove old requests outside the window
  RATE_LIMIT.requests = RATE_LIMIT.requests.filter(time => time > windowStart);
  
  if (RATE_LIMIT.requests.length >= RATE_LIMIT.maxRequests) {
    throw new Error('Rate limit exceeded. Please wait before making more requests.');
  }
  
  RATE_LIMIT.requests.push(now);
}

// Exponential backoff retry logic
async function retryWithBackoff(operation, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error.message);
      
      // Don't retry on certain errors
      if (error.message.includes('Invalid OAuth') || 
          error.message.includes('Invalid API key') ||
          error.message.includes('Permission denied')) {
        throw error;
      }
      
      if (attempt === maxAttempts) {
        throw new Error(`Operation failed after ${maxAttempts} attempts: ${error.message}`);
      }
      
      // Exponential backoff with jitter
      const baseDelay = Math.min(1000 * Math.pow(2, attempt - 1), 30000);
      const jitter = Math.random() * 1000;
      const delay = baseDelay + jitter;
      
      console.log(`Retrying in ${Math.round(delay)}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Get albums with caching to reduce API calls
let albumsCache = null;
let albumsCacheTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

async function getAlbums(forceRefresh = false) {
  const now = Date.now();
  
  if (!forceRefresh && albumsCache && (now - albumsCacheTime < CACHE_DURATION)) {
    return albumsCache;
  }
  
  try {
    checkRateLimit();
    
    const res = await retryWithBackoff(async () => {
      return await flickr('flickr.photosets.getList', { user_id: userId });
    });
    
    if (!res.photosets || !res.photosets.photoset) {
      albumsCache = [];
    } else {
      albumsCache = res.photosets.photoset.map((set) => ({
        id: set.id,
        title: set.title._content,
      }));
    }
    
    albumsCacheTime = now;
    console.log(`Retrieved ${albumsCache.length} albums from Flickr`);
    return albumsCache;
    
  } catch (error) {
    console.error('Error getting albums:', error);
    // Return cached data if available, otherwise empty array
    return albumsCache || [];
  }
}

// Find or create album with strict duplicate prevention
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
    
    const res = await retryWithBackoff(async () => {
      return await flickr('flickr.photosets.create', {
        title: albumTitle,
        primary_photo_id: primaryPhotoId,
        description: `Private album: ${albumTitle}`,
      });
    });

    // Invalidate cache since we created a new album
    albumsCache = null;
    
    console.log(`Created album: "${albumTitle}" (ID: ${res.photoset.id})`);
    return res.photoset.id;
    
  } catch (error) {
    console.error('Album operation failed:', error);
    throw new Error(`Album operation failed: ${error.message}`);
  }
}

// Upload photo with comprehensive error handling
async function uploadPhotoFromUrl(imageUrl, title, albumTitle) {
  let tempFilePath = null;
  
  try {
    // Download image with timeout
    console.log(`Downloading image from: ${imageUrl}`);
    
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    
    const response = await fetch(imageUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Flickr-Uploader/1.0'
      }
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
    
    if (buffer.length > 200 * 1024 * 1024) { // 200MB limit
      throw new Error('File too large. Maximum size is 200MB.');
    }

    // Prepare file for upload
    const fileName = title.endsWith('.jpg') ? title : `${title}.jpg`;
    tempFilePath = join(tmpdir(), `flickr_${Date.now()}_${fileName}`);
    await writeFile(tempFilePath, buffer);
    
    console.log(`File saved temporarily: ${tempFilePath} (${buffer.length} bytes)`);

    // Upload photo as private with retry logic
    console.log(`Uploading photo: "${title}"`);
    
    const photoId = await retryWithBackoff(async () => {
      return await upload(tempFilePath, {
        title: title,
        description: `Uploaded via API on ${new Date().toISOString()}`,
        is_public: 0,  // Private
        is_friend: 0,  // Not visible to friends
        is_family: 0,  // Not visible to family
        hidden: 2,     // Hide from public searches
      });
    });
    
    console.log(`Photo uploaded successfully (ID: ${photoId})`);

    // Handle album creation/assignment
    const albumId = await findOrCreateAlbum(albumTitle, photoId);
    
    // Add to album only if it's an existing album
    const albums = await getAlbums();
    const albumExisted = albums.some(a => 
      a.id === albumId && a.title.toLowerCase().trim() === albumTitle.toLowerCase().trim()
    );
    
    if (albumExisted) {
      try {
        checkRateLimit();
        
        await retryWithBackoff(async () => {
          return await flickr('flickr.photosets.addPhoto', {
            photoset_id: albumId,
            photo_id: photoId,
          });
        });
        
        console.log(`Photo added to existing album: ${albumTitle}`);
      } catch (addError) {
        console.warn(`Could not add photo to album: ${addError.message}`);
        // Don't fail the entire upload for this
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
    // Always clean up temp file
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

// Validate environment variables
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
  
  if (!flickr || !upload) {
    throw new Error('Flickr SDK failed to initialize');
  }
}

// Main handler
module.exports = async (req, res) => {
  // Set security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Health check with enhanced success message
  if (req.method === 'GET') {
    try {
      validateEnvironment();
      
      return res.status(200).json({
        status: '🎉 FLICKR UPLOADER LIVE!',
        message: 'Production Flickr Photo Uploader Successfully Deployed & Configured',
        service: 'Flickr Photo Uploader',
        version: '1.0.0',
        deployment: 'SUCCESS ✅',
        configured: '✅ READY',
        features: [
          '📸 Private photo uploads',
          '📁 Smart album management', 
          '🔒 Rate limiting & retry logic',
          '⚡ Optimized for Make.com'
        ],
        endpoints: {
          health: 'GET /',
          upload: 'POST /upload'
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
        message: 'App deployed successfully but missing environment variables',
        service: 'Flickr Photo Uploader',
        version: '1.0.0',
        deployment: 'SUCCESS ✅',
        configured: '❌ MISSING ENV VARS',
        error: error.message,
        timestamp: new Date().toISOString(),
        action: 'Add Flickr API credentials to Vercel environment variables',
        needed: [
          'FLICKR_API_KEY',
          'FLICKR_API_SECRET',
          'FLICKR_ACCESS_TOKEN', 
          'FLICKR_ACCESS_SECRET',
          'FLICKR_USER_ID'
        ]
      });
    }
  }

  // Handle upload requests
  if (req.method === 'POST') {
    const startTime = Date.now();
    
    try {
      validateEnvironment();
      
      const { imageUrl, dropboxUrl, albumPath, title, description } = req.body;

      // Input validation
      const sourceUrl = dropboxUrl || imageUrl;
      if (!sourceUrl) {
        return res.status(400).json({ 
          error: 'Missing required field: imageUrl or dropboxUrl',
          timestamp: new Date().toISOString()
        });
      }
      
      if (!albumPath) {
        return res.status(400).json({ 
          error: 'Missing required field: albumPath',
          timestamp: new Date().toISOString()
        });
      }

      // Validate URL format
      try {
        new URL(sourceUrl);
      } catch {
        return res.status(400).json({ 
          error: 'Invalid URL format',
          timestamp: new Date().toISOString()
        });
      }

      // Parse album path
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

      // Generate title from URL if not provided
      const photoTitle = title || parse(sourceUrl).name || `Photo_${Date.now()}`;
      
      console.log(`Processing upload: ${photoTitle} -> ${albumTitle}`);

      // Perform upload
      const result = await uploadPhotoFromUrl(sourceUrl, photoTitle, albumTitle);
      
      const duration = Date.now() - startTime;
      console.log(`Upload completed in ${duration}ms`);

      // Return success response in expected format
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
      
      // Determine appropriate HTTP status code
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
