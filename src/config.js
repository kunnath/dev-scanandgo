require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  jwtSecret: process.env.JWT_SECRET || 'scanandgo_default_secret',
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/scanandgo',
  gpsSimulation: process.env.GPS_SIMULATION === 'true',
  gpsUpdateIntervalMs: parseInt(process.env.GPS_UPDATE_INTERVAL_MS) || 5000,
  qrTicketExpiryMinutes: parseInt(process.env.QR_TICKET_EXPIRY_MINUTES) || 120,
  appName: process.env.APP_NAME || 'ScanAndGo',
  appCity: process.env.APP_CITY || 'Kerala',
  razorpayKeyId: process.env.RAZORPAY_KEY_ID || 'PLACEHOLDER',
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET || 'PLACEHOLDER',
  ownerSubscriptionThirtyDaysAmount: process.env.OWNER_SUB_30_DAYS_AMOUNT || 'free',
  ownerSubscriptionMonthlyAmount: parseInt(process.env.OWNER_SUB_MONTHLY_AMOUNT || '499', 10),
  ownerSubscriptionYearlyAmount: parseInt(process.env.OWNER_SUB_YEARLY_AMOUNT || '4999', 10),
  ownerSubscriptionReceiverUpi: process.env.OWNER_SUB_RECEIVER_UPI || 'kunnathadi@icici',
  smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com',
  smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  emailFrom: process.env.EMAIL_FROM || 'ScanAndGo <qakunnath@gmail.com>',
  appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:3000',
  resendApiKey: process.env.RESEND_API_KEY || process.env.resend_api_key || '',
  // The API base URL needs to be your production backend, e.g.:
  API_BASE: process.env.NODE_ENV === 'production'
    ? 'https://scanandgo-api-s4y4.onrender.com/api'
    : 'http://localhost:3000/api',
  // Cloudflare R2 (S3-compatible object storage)
  r2AccessKeyId:     process.env.R2_ACCESS_KEY_ID || '',
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  r2AccountId:       process.env.R2_ACCOUNT_ID || '',
  r2BucketName:      process.env.R2_BUCKET_NAME || 'poyalo',
  r2Endpoint:        process.env.R2_ENDPOINT_S3_CLIENTS || '',
  r2PublicUrl:       process.env.R2_PUBLIC_URL || '',
};
