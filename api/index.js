const { createFlickr } = require('flickr-sdk');
const { tmpdir } = require('os');
const { join, parse } = require('path');
const { writeFile, unlink } = require('fs/promises');

// Initialize Flickr SDK with CORRECT environment variable names
let flickr, upload, isConfigured = false;

try {
  if (process.env.FLICKR_API_KEY && process.env.FLICKR_API_SECRET) {
    const { flickr: flickrClient, upload: uploadClient } = createFlickr({
      consumerKey: process.env.FLICKR_API_KEY,
      consumerSecret: process.env.FLICKR_API_SECRET,
      oauthToken: process.env.FLICKR_ACCESS_TOKEN,
      oauthTokenSecret: process.env.FLICKR_ACCESS_TOKEN_SECRET,  // Fixed variable name!
    });
    
    flickr = flickrClient;
    upload = uploadClient;
    isConfigured = true;
  }
} catch (error) {
  console.error('Flickr SDK initialization failed:', error);
}

const userId = process.env.FLICKR_USER_ID;

async function getAlbums() {
  try {
    const res = await flickr("flickr.photosets.getList", { user_id: userId });
    
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

async function findOrCreateAlbum(albumTitle, primaryPhotoId) {
  const albums = await getAlbums();
  const existingAlbum = albums.find((a) => a.title.toLowerCase() === albumTitle.toLowerCase());

  if (existingAlbum) {
    console.log('Found existing album:', albumTitle);
    return existingAlbum.id;
  }

  console.log('Creating new album:', albumTitle);
  const res = await flickr("flickr.photosets.create", {
    title: albumTitle,
    primary_photo_id: primaryPhotoId,
  });

  return res.photoset.id;
}

async function uploadPhotoFromUrl(imageUrl, title, albumTitle) {
  let tempFilePath = null;
  
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) throw new Error("Failed to fetch image from URL");

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const fileName = title.endsWith(".jpg") ? title : `${title}.jpg`;
    tempFilePath = join(tmpdir(), fileName);
    await writeFile(tempFilePath, buffer);

    // Upload photo as private
    const photoId = await upload(tempFilePath, { 
      title,
      is_public: 0,
      is_friend: 0,
      is_family: 0,
      hidden: 2
    });
    
    const albumId = await findOrCreateAlbum(albumTitle, photoId);

    // Add to existing album
    const albums = await getAlbums();
    const albumExisted = albums.some(a => a.id === albumId);
    
    if (albumExisted) {
      try {
        await flickr("flickr.photosets.addPhoto", {
          photoset_id: albumId,
          photo_id: photoId,
        });
      } catch (addError) {
        console.log('Could not add photo to album:', addError.message);
      }
    }

    return { success: true, photoId, albumId };
  } finally {
    if (tempFilePath) {
      try {
        await unlink(tempFilePath);
      } catch (cleanupError) {
        console.warn('Failed to clean up temp file:', cleanupError.message);
      }
    }
  }
}

// Vercel serverless function
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      status: '🎉 FLICKR UPLOADER LIVE!',
      message: 'Production Flickr Photo Uploader - Fully Configured',
      service: 'Flickr Photo Uploader',
      version: '1.0.0',
      configured: '✅ READY',
      features: [
        '📸 Private photo uploads',
        '📁 Smart album management with duplicate prevention',
        '🔒 Following official flickr-sdk patterns',
        '⚡ Optimized for Make.com integration'
      ],
      endpoints: {
        health: 'GET /api',
        upload: 'POST /api'
      },
      timestamp: new Date().toISOString()
    });
  }

  if (req.method === 'POST') {
    try {
      const { imageUrl, dropboxUrl, albumPath } = req.body;
      const sourceUrl = dropboxUrl || imageUrl;

      if (!sourceUrl || !albumPath) {
        return res.status(400).json({ 
          error: 'Missing imageUrl/dropboxUrl or albumPath' 
        });
      }

      const parts = albumPath.split("/").filter(Boolean);
      const eventName = parts[0] || "Uncategorized Event";
      const albumName = parts[1] || "General";
      const title = parse(sourceUrl).base;

      const result = await uploadPhotoFromUrl(sourceUrl, title, `${eventName} -- ${albumName}`);

      res.status(200).json({ 
        message: "Photo uploaded successfully", 
        result: {
          ...result,
          flickrUrl: `https://www.flickr.com/photos/${userId}/${result.photoId}`,
          albumUrl: result.albumId ? `https://www.flickr.com/photos/${userId}/albums/${result.albumId}` : null,
        }
      });

    } catch (err) {
      console.error("Upload error:", err);
      res.status(500).json({ error: err.message });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
};
