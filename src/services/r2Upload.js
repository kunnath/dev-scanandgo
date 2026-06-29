/**
 * Cloudflare R2 upload service (S3-compatible)
 * Used for storing conductor expense proof files (PNG, JPEG, PDF).
 */
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { randomUUID } = require('crypto');
const path = require('path');
const config = require('../config');

// Allowed MIME types and their extensions
const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/jpg':  'jpg',
  'image/png':  'png',
  'application/pdf': 'pdf',
};

// Create R2 client once
const r2Client = new S3Client({
  region: 'auto',
  endpoint: config.r2Endpoint,
  credentials: {
    accessKeyId:     config.r2AccessKeyId,
    secretAccessKey: config.r2SecretAccessKey,
  },
});

/**
 * Upload a file buffer to Cloudflare R2.
 * @param {Buffer} buffer       File data
 * @param {string} mimeType     MIME type (e.g. 'image/jpeg')
 * @param {string} originalName Original filename from client
 * @param {string} folder       R2 key prefix (e.g. 'expenses/busId')
 * @returns {{ key: string, publicUrl: string, originalName: string, mimeType: string }}
 */
async function uploadToR2(buffer, mimeType, originalName, folder) {
  const ext = ALLOWED_TYPES[mimeType];
  if (!ext) {
    throw new Error(`Unsupported file type: ${mimeType}. Allowed: PNG, JPEG, PDF`);
  }

  const key = `${folder}/${randomUUID()}.${ext}`;

  await r2Client.send(new PutObjectCommand({
    Bucket:      config.r2BucketName,
    Key:         key,
    Body:        buffer,
    ContentType: mimeType,
  }));

  const publicUrl = `${config.r2PublicUrl}/${key}`;

  return {
    key,
    publicUrl,
    originalName: path.basename(originalName || `file.${ext}`),
    mimeType,
  };
}

/**
 * Delete a file from R2 by key.
 * @param {string} key R2 object key
 */
async function deleteFromR2(key) {
  if (!key) return;
  await r2Client.send(new DeleteObjectCommand({
    Bucket: config.r2BucketName,
    Key:    key,
  }));
}

/**
 * Generate a temporary pre-signed URL for downloading a private R2 object.
 * Valid for 1 hour by default.
 * @param {string} key        R2 object key
 * @param {number} expiresIn  Seconds until URL expires (default 3600)
 * @returns {Promise<string>} Pre-signed URL
 */
async function getSignedProofUrl(key, expiresIn = 3600) {
  const command = new GetObjectCommand({
    Bucket: config.r2BucketName,
    Key:    key,
  });
  return getSignedUrl(r2Client, command, { expiresIn });
}

module.exports = { uploadToR2, deleteFromR2, getSignedProofUrl, ALLOWED_TYPES };
