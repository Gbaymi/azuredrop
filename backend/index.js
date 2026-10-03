const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Azure Storage & Identity SDKs
const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');

const app = express();
app.use(express.json());

// 1. Storage Configuration
const UPLOAD_MODE = process.env.UPLOAD_MODE || 'local'; // 'azure' or 'local'
const AZURE_STORAGE_ACCOUNT_NAME = process.env.AZURE_STORAGE_ACCOUNT_NAME;
const AZURE_CONTAINER_NAME = process.env.AZURE_CONTAINER_NAME || 'azuredrop-files';

let blobContainerClient = null;

if (UPLOAD_MODE === 'azure' && AZURE_STORAGE_ACCOUNT_NAME) {
  // Uses VM System-Assigned Managed Identity automatically via DefaultAzureCredential
  const accountUrl = `https://${AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net`;
  const blobServiceClient = new BlobServiceClient(accountUrl, new DefaultAzureCredential());
  blobContainerClient = blobServiceClient.getContainerClient(AZURE_CONTAINER_NAME);

  // Auto-create storage container if it doesn't exist
  blobContainerClient.createIfNotExists().then(() => {
    console.log(`Connected to Azure Blob Storage Container: ${AZURE_CONTAINER_NAME}`);
  }).catch(err => console.error('Azure Storage init error:', err.message));
} else {
  console.log('Running in LOCAL file upload mode');
}

// 2. Local Fallback Directory
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Configure Multer (Buffer memory storage for Azure streaming, disk for local)
const storage = UPLOAD_MODE === 'azure' ? multer.memoryStorage() : multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});
const upload = multer({ storage });

// 3. PostgreSQL Database Connection
const pool = new Pool({
  host: process.env.DB_HOST || 'db',
  user: process.env.DB_USER || 'azuredrop_user',
  password: process.env.DB_PASSWORD || 'azuredrop_password',
  database: process.env.DB_NAME || 'azuredrop_db',
  port: process.env.DB_PORT || 5432,
});

// Auto-create PostgreSQL 'files' table
const initDb = async () => {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS files (
      id SERIAL PRIMARY KEY,
      original_name VARCHAR(255) NOT NULL,
      storage_path VARCHAR(512) NOT NULL,
      mime_type VARCHAR(100),
      file_size BIGINT,
      storage_mode VARCHAR(50) DEFAULT 'local',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  try {
    await pool.query(createTableQuery);
    console.log("PostgreSQL 'files' table verified/created.");
  } catch (err) {
    console.error("Error creating database table:", err);
  }
};
initDb();

// 4. Health Check Endpoint
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ 
      status: 'UP', 
      database: 'connected', 
      mode: UPLOAD_MODE,
      timestamp: new Date().toISOString() 
    });
  } catch (err) {
    res.status(500).json({ status: 'DOWN', database: err.message });
  }
});

// 5. File Upload Endpoint (Handles both Azure & Local)
app.post('/api/files/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const { originalname, mimetype, size } = req.file;
    let fileStoragePath = '';

    if (UPLOAD_MODE === 'azure' && blobContainerClient) {
      // Stream file directly to Azure Blob Storage
      const blobName = `${Date.now()}-${originalname}`;
      const blockBlobClient = blobContainerClient.getBlockBlobClient(blobName);
      
      await blockBlobClient.uploadData(req.file.buffer, {
        blobHTTPHeaders: { blobContentType: mimetype }
      });
      
      fileStoragePath = blockBlobClient.url;
    } else {
      // Local disk fallback path
      fileStoragePath = req.file.path;
    }

    // Save metadata in PostgreSQL
    const insertQuery = `
      INSERT INTO files (original_name, storage_path, mime_type, file_size, storage_mode)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;
    const result = await pool.query(insertQuery, [originalname, fileStoragePath, mimetype, size, UPLOAD_MODE]);

    res.status(201).json({
      message: 'File uploaded successfully!',
      file: result.rows[0]
    });
  } catch (err) {
    console.error('Upload Error:', err);
    res.status(500).json({ error: 'Failed to process file upload.' });
  }
});

// 6. List Uploaded Files
app.get('/api/files', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM files ORDER BY created_at DESC');
    res.status(200).json({ files: result.rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve files.' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
}); 