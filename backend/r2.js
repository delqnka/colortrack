const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { randomUUID } = require('crypto');

function r2Configured() {
  return Boolean(
    process.env.R2_ENDPOINT &&
      process.env.R2_BUCKET &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY,
  );
}

function normalizeEndpoint() {
  return String(process.env.R2_ENDPOINT).replace(/\/$/, '');
}

/** @returns {import('@aws-sdk/client-s3').S3Client} */
function getS3Client() {
  return new S3Client({
    region: 'auto',
    endpoint: normalizeEndpoint(),
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });
}

const ALLOWED_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

function normalizeContentType(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.split(';')[0].trim().toLowerCase();
  if (s === 'image/jpg') return 'image/jpeg';
  if (ALLOWED_TYPES.has(s)) return s;
  return null;
}

function extForType(contentType) {
  return ALLOWED_TYPES.get(contentType) || null;
}

/** Presigned uploads for invoice import OCR (temporary objects). */
const INVOICE_IMPORT_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['application/pdf', 'pdf'],
]);

function normalizeInvoiceImportContentType(raw) {
  if (typeof raw !== 'string') return null;
  const s = raw.split(';')[0].trim().toLowerCase();
  if (s === 'image/jpg') return 'image/jpeg';
  return INVOICE_IMPORT_TYPES.has(s) ? s : null;
}

function invoiceImportExt(contentType) {
  return INVOICE_IMPORT_TYPES.get(contentType) || null;
}

function invoiceImportPrefixForSalon(salonId) {
  const sid = Number(salonId);
  if (!Number.isFinite(sid) || sid <= 0) return null;
  return `salons/${sid}/invoice-imports/`;
}

function buildInvoiceImportKey(salonId, contentType) {
  const prefix = invoiceImportPrefixForSalon(salonId);
  const ext = invoiceImportExt(contentType);
  if (!prefix || !ext) return null;
  return `${prefix}${randomUUID()}.${ext}`;
}

function keyBelongsToSalonInvoiceImport(salonId, key) {
  const prefix = invoiceImportPrefixForSalon(salonId);
  if (typeof key !== 'string' || key.includes('..') || !prefix) return false;
  if (!key.startsWith(prefix)) return false;
  const rest = key.slice(prefix.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|pdf)$/i.test(rest);
}

/** Presigned uploads for service price-list OCR (temporary images only). */
function serviceImportPrefixForSalon(salonId) {
  const sid = Number(salonId);
  if (!Number.isFinite(sid) || sid <= 0) return null;
  return `salons/${sid}/service-imports/`;
}

function buildServiceImportKey(salonId, contentType) {
  const prefix = serviceImportPrefixForSalon(salonId);
  const ext = extForType(contentType);
  if (!prefix || !ext) return null;
  return `${prefix}${randomUUID()}.${ext}`;
}

function keyBelongsToSalonServiceImport(salonId, key) {
  const prefix = serviceImportPrefixForSalon(salonId);
  if (typeof key !== 'string' || key.includes('..') || !prefix) return false;
  if (!key.startsWith(prefix)) return false;
  const rest = key.slice(prefix.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i.test(rest);
}

async function getObjectBuffer(key) {
  const client = getS3Client();
  const out = await client.send(
    new GetObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
    }),
  );
  const headCt = typeof out.ContentType === 'string' ? out.ContentType.split(';')[0].trim().toLowerCase() : '';
  if (!out.Body) {
    return { buffer: Buffer.alloc(0), contentType: headCt };
  }
  const chunks = [];
  for await (const chunk of out.Body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const buffer = Buffer.concat(chunks);
  return { buffer, contentType: headCt };
}

function keyPrefixForClient(clientId) {
  return `clients/${clientId}/`;
}

function keyPrefixForStaff(staffId) {
  return `staff/${staffId}/`;
}

function buildObjectKey(clientId, contentType) {
  const ext = extForType(contentType);
  if (!ext) return null;
  return `${keyPrefixForClient(clientId)}${randomUUID()}.${ext}`;
}

function keyBelongsToClient(clientId, key) {
  if (typeof key !== 'string' || key.includes('..')) return false;
  const prefix = keyPrefixForClient(clientId);
  if (!key.startsWith(prefix)) return false;
  const rest = key.slice(prefix.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i.test(rest);
}

function buildAvatarKey(clientId, contentType) {
  const ext = extForType(contentType);
  if (!ext) return null;
  return `${keyPrefixForClient(clientId)}avatar-${randomUUID()}.${ext}`;
}

function keyBelongsToClientAvatar(clientId, key) {
  if (typeof key !== 'string' || key.includes('..')) return false;
  const prefix = keyPrefixForClient(clientId);
  if (!key.startsWith(prefix)) return false;
  const rest = key.slice(prefix.length);
  return /^avatar-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i.test(rest);
}

function buildStaffAvatarKey(staffId, contentType) {
  const ext = extForType(contentType);
  if (!ext) return null;
  return `${keyPrefixForStaff(staffId)}avatar-${randomUUID()}.${ext}`;
}

function keyBelongsToStaffAvatar(staffId, key) {
  if (typeof key !== 'string' || key.includes('..')) return false;
  const prefix = keyPrefixForStaff(staffId);
  if (!key.startsWith(prefix)) return false;
  const rest = key.slice(prefix.length);
  return /^avatar-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i.test(rest);
}

async function presignPut(key, contentType) {
  const client = getS3Client();
  const cmd = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client, cmd, { expiresIn: 900 });
}

async function presignGet(key) {
  const client = getS3Client();
  const cmd = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
  });
  return getSignedUrl(client, cmd, { expiresIn: 3600 });
}

async function deleteObject(key) {
  const client = getS3Client();
  await client.send(
    new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
    }),
  );
}

function buildVisitPhotoKey(visitId, photoType, contentType) {
  const ext = extForType(contentType);
  if (!ext) return null;
  return `visits/${visitId}/${photoType}_${randomUUID()}.${ext}`;
}

function keyBelongsToVisit(visitId, key) {
  if (typeof key !== 'string' || key.includes('..')) return false;
  return key.startsWith(`visits/${visitId}/`) &&
    /\.(jpg|png|webp)$/i.test(key);
}

module.exports = {
  r2Configured,
  normalizeContentType,
  normalizeInvoiceImportContentType,
  buildObjectKey,
  buildAvatarKey,
  buildStaffAvatarKey,
  buildInvoiceImportKey,
  buildServiceImportKey,
  keyBelongsToClient,
  keyBelongsToClientAvatar,
  keyBelongsToStaffAvatar,
  buildVisitPhotoKey,
  keyBelongsToVisit,
  keyBelongsToSalonInvoiceImport,
  keyBelongsToSalonServiceImport,
  presignPut,
  presignGet,
  getObjectBuffer,
  deleteObject,
};