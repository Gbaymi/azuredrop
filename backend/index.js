const express = require('express');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

// Setup local uploads directory for development testing
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Configure Multer to store uploaded files locally in /app/uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, `${uniqueSuffix}-${file.originalname}`);
  }
});
const upload = multer({ storage });

// Database Connection
const pool = new Pool({
  host: process.env.DB_HOST || 'db',
  user: process.env.DB_USER || 'azuredrop_user',
  password: process.env.DB_PASSWORD || 'azuredrop_password',
  database: process.env.DB_NAME || 'azuredrop_db',
  port: process.env.DB_PORT || 5432,
});

// Auto-create PostgreSQL 'files' table on server boot
const initDb = async () => {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS files (
      id SERIAL PRIMARY KEY,
      original_name VARCHAR(255) NOT NULL,
      storage_path VARCHAR(512) NOT NULL,
      mime_type VARCHAR(100),
      file_size BIGINT,
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

// 1. Health Check Route
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'UP', database: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'DOWN', database: err.message });
  }
});

// 2. File Upload Route
app.post('/api/files/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    const { originalname, path: filePath, mimetype, size } = req.file;

    // Save metadata to PostgreSQL
    const insertQuery = `
      INSERT INTO files (original_name, storage_path, mime_type, file_size)
      VALUES ($1, $2, $3, $4)
      RETURNING *;
    `;
    const result = await pool.query(insertQuery, [originalname, filePath, mimetype, size]);

    res.status(201).json({
      message: 'File uploaded successfully!',
      file: result.rows[0]
    });
  } catch (err) {
    console.error('Upload Error:', err);
    res.status(500).json({ error: 'Failed to process file upload.' });
  }
});

// 3. List Uploaded Files Route
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