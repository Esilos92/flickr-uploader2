import express from "express";
import multer from "multer";
import { createFlickr } from "flickr-sdk";
import { tmpdir } from "os";
import { join, parse } from "path";
import { writeFile } from "fs/promises";
import { unlink } from "fs/promises";

// Flickr credentials (replace with your actual secrets)
const { flickr, upload } = createFlickr({
  consumerKey: process.env.FLICKR_API_KEY,
  consumerSecret: process.env.FLICKR_API_SECRET,
  oauthToken: process.env.FLICKR_ACCESS_TOKEN,
  oauthTokenSecret: process.env.FLICKR_ACCESS_SECRET,
});

const userId = process.env.FLICKR_USER_ID;

const app = express();
const uploadMiddleware = multer({ dest: tmpdir() });

app.use(express.json());

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
  // Case-insensitive search for existing album to prevent duplicates
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
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error("Failed to fetch image from URL");

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const fileName = title.endsWith(".jpg") ? title : `${title}.jpg`;
  const tempFilePath = join(tmpdir(), fileName);
  await writeFile(tempFilePath, buffer);

  try {
    // Upload photo as private
    const photoId = await upload(tempFilePath, { 
      title,
      is_public: 0,  // Private
      is_friend: 0,
      is_family: 0,
      hidden: 2      // Hide from public searches
    });
    
    const albumId = await findOrCreateAlbum(albumTitle, photoId);

    // Only add to album if it already existed (to avoid adding primary photo twice)
    const albums = await getAlbums();
    const albumExisted = albums.some(a => a.id === albumId);
    
    if (albumExisted) {
      try {
        await flickr("flickr.photosets.addPhoto", {
          photoset_id: albumId,
          photo_id: photoId,
        });
        console.log('Photo added to existing album');
      } catch (addError) {
        console.log('Note: Could not add photo to album (may already be primary):', addError.message);
      }
    }

    return { success: true, photoId, albumId };
  } finally {
    await unlink(tempFilePath);
  }
}

// Health check
app.get("/", (req, res) => {
  res.json({
    status: "🎉 FLICKR UPLOADER LIVE!",
    message: "Express app successfully deployed",
    service: "Flickr Photo Uploader",
    version: "1.0.0",
    endpoints: {
      health: "GET /",
      upload: "POST /upload"
    },
    timestamp: new Date().toISOString()
  });
});

app.post("/upload", uploadMiddleware.none(), async (req, res) => {
  try {
    const { imageUrl, dropboxUrl, albumPath } = req.body;

    // Support both imageUrl and dropboxUrl
    const sourceUrl = dropboxUrl || imageUrl;

    if (!sourceUrl || !albumPath) {
      return res.status(400).json({ error: "Missing imageUrl/dropboxUrl or albumPath" });
    }

    const parts = albumPath.split("/").filter(Boolean);
    const eventName = parts[0] || "Uncategorized Event";
    const albumName = parts[1] || "General";

    const title = parse(sourceUrl).base;

    const result = await uploadPhotoFromUrl(sourceUrl, title, `${eventName} -- ${albumName}`);

    res.json({ message: "Photo uploaded", result });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default app;
