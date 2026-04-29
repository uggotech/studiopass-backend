import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(process.cwd(), ".env") });

export default {
  // ============================================================================
  // APPLICATION SETTINGS
  // ============================================================================
  app_name: process.env.APP_NAME,
  app_public_name: process.env.APP_PUBLIC_NAME,
  node_env: process.env.NODE_ENV,
  ip_address: process.env.IP_ADDRESS,
  port: process.env.PORT,

  // ============================================================================
  // DATABASE
  // ============================================================================
  database_url: process.env.DATABASE_URL,
  database: {
    max_pool_size: process.env.DB_MAX_POOL_SIZE || "10",
    server_selection_timeout_ms: process.env.DB_SERVER_SELECTION_TIMEOUT_MS || "5000",
    socket_timeout_ms: process.env.DB_SOCKET_TIMEOUT_MS || "30000",
    wait_queue_timeout_ms: process.env.DB_WAIT_QUEUE_TIMEOUT_MS || "10000",
    max_idle_time_ms: process.env.DB_MAX_IDLE_TIME_MS || "60000",
  },

  // ============================================================================
  // SECURITY
  // ============================================================================
  bcrypt_salt_rounds: process.env.BCRYPT_SALT_ROUNDS || "8",
  admin_secret_key: process.env.ADMIN_SECRET_KEY,

  // ============================================================================
  // JWT (JSON Web Tokens)
  // ============================================================================
  jwt: {
    jwt_secret: process.env.JWT_SECRET,
    jwt_expire_in: process.env.JWT_EXPIRE_IN || "30d",
    jwt_refresh_secret: process.env.JWT_REFRESH_SECRET,
    jwt_refresh_expire_in: process.env.JWT_REFRESH_EXPIRE_IN || "30d",
  },

  // ============================================================================
  // EMAIL CONFIGURATION (SMTP)
  // ============================================================================
  email: {
    from: process.env.EMAIL_FROM,
    user: process.env.EMAIL_USER,
    port: process.env.EMAIL_PORT || "587",
    host: process.env.EMAIL_HOST || "smtp.gmail.com",
    pass: process.env.EMAIL_PASS,
  },

  // ============================================================================
  // EMAIL SERVICE (Resend)
  // ============================================================================
  resend: {
    api_key: process.env.RESEND_API_KEY,
    mail_domain: process.env.MAIL_DOMAIN,
  },

  // ============================================================================
  // SUPER ADMIN
  // ============================================================================
  super_admin: {
    phone: process.env.SUPER_ADMIN_PHONE,
    password: process.env.SUPER_ADMIN_PASSWORD,
  },

  // ============================================================================
  // REDIS / CACHING
  // ============================================================================
  redis: {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: process.env.REDIS_PORT || "6379",
    password: process.env.REDIS_PASSWORD,
  },

  cache: {
    enabled: process.env.CACHE_ENABLED !== "false",
    prefix: process.env.CACHE_PREFIX || "studiopass",
    ttl: {
      interestCatalogSeconds: process.env.CACHE_INTEREST_CATALOG_TTL_SECONDS || "86400",
      userProfileSeconds: process.env.CACHE_USER_PROFILE_TTL_SECONDS || "300",
      usernameAvailabilitySeconds: process.env.CACHE_USERNAME_AVAILABILITY_TTL_SECONDS || "60",
    },
  },

  // ============================================================================
  // GOOGLE INTEGRATION
  // ============================================================================
  google: {
    service_account_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY,
    default_range: process.env.GOOGLE_SHEET_DEFAULT_RANGE || "Sheet1!A:Z",
  },

  // ============================================================================
  // FIREBASE — Service Account (Phone OTP / Admin SDK)
  // ============================================================================
  firebase: {
    type: process.env.FIREBASE_TYPE,
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY,
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    client_id: process.env.FIREBASE_CLIENT_ID,
    auth_uri: process.env.FIREBASE_AUTH_URI,
    token_uri: process.env.FIREBASE_TOKEN_URI,
    auth_provider_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
    client_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
    universe_domain: process.env.FIREBASE_UNIVERSE_DOMAIN,
  },

  // ============================================================================
  // AFRICA'S TALKING (SMS OTP)
  // ============================================================================
  africas_talking: {
    api_key: process.env.AT_API_KEY as string,
    username: process.env.AT_USERNAME as string,
  },

  // ============================================================================
  // TWILIO (SMS OTP fallback for non-Africa's Talking countries)
  // ============================================================================
  twilio: {
    account_sid: process.env.TWILIO_ACCOUNT_SID,
    auth_token: process.env.TWILIO_AUTH_TOKEN,
    from_number: process.env.TWILIO_FROM_NUMBER,
  },

  // ============================================================================
  // DEVELOPMENT / TESTING FLAGS
  // ============================================================================
  dev: {
    // Set SKIP_KYC_FOR_TEST=true in .env to bypass KYC checks locally.
    // Only respected when NODE_ENV=development.
    skip_kyc_for_test: process.env.SKIP_KYC_FOR_TEST === "true",
  },

  // ============================================================================
  // KYC / VERIFICATION (Veriff)
  // ============================================================================
  veriff: {
    secret_key: process.env.VERIFF_SECRET_KEY,
    api_endpoint: process.env.VERIFF_API_ENDPOINT || "https://api.veriff.com",
    webhook_secret: process.env.VERIFF_WEBHOOK_SECRET,
  },

  // ============================================================================
  // PAYMENT PROCESSING - STRIPE
  // ============================================================================
  stripe: {
    secret_key: process.env.STRIPE_SECRET_KEY,
    publishable_key: process.env.STRIPE_PUBLISHABLE_KEY,
    webhook_secret: process.env.STRIPE_WEBHOOK_SECRET,
    hold_days_in_person: process.env.STRIPE_HOLD_DAYS_IN_PERSON || "14",
    hold_days_circle: process.env.STRIPE_HOLD_DAYS_CIRCLE || "7",
    min_payout_amount: process.env.STRIPE_MIN_PAYOUT_AMOUNT || "50",
    processor_fee_percent: process.env.STRIPE_PROCESSOR_FEE_PERCENT || "2.9",
  },

  // ============================================================================
  // PAYMENT - PLATFORM FEES
  // ============================================================================
  payment: {
    platform_fee_percent: process.env.PAYMENT_PLATFORM_FEE_PERCENT || "20",
  },

  // ============================================================================
  // IN-APP PURCHASE (IAP) - APPLE
  // ============================================================================
  apple_iap: {
    bundle_id: process.env.APPLE_BUNDLE_ID || "com.studiopass.app",
    team_id: process.env.APPLE_TEAM_ID,
    key_id: process.env.APPLE_KEY_ID,
    private_key: process.env.APPLE_PRIVATE_KEY,
    shared_secret: process.env.APPLE_IAP_SHARED_SECRET,
    app_store_server_token: process.env.APPLE_APP_STORE_SERVER_TOKEN,
    fee_percent: process.env.APPLE_FEE_PERCENT || "30",
    settlement_days: process.env.APPLE_SETTLEMENT_DAYS || "45",
    payout_buffer_days: process.env.APPLE_PAYOUT_BUFFER_DAYS || "30",
    total_hold_days: process.env.APPLE_TOTAL_HOLD_DAYS || "45",
  },

  // ============================================================================
  // IN-APP PURCHASE (IAP) - GOOGLE PLAY
  // ============================================================================
  google_play_iap: {
    package_name: process.env.GOOGLE_PLAY_PACKAGE_NAME || "com.studiopass.app",
    service_account_json: process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || "{}",
    fee_percent: process.env.GOOGLE_PLAY_FEE_PERCENT || "30",
    payout_buffer_days: process.env.GOOGLE_PLAY_PAYOUT_BUFFER_DAYS || "30",
  },

  // ============================================================================
  // LOGGING & MONITORING
  // ============================================================================
  logging: {
    level: process.env.LOG_LEVEL || "debug",
    format: process.env.LOG_FORMAT || "json",
    enable_request_logging: process.env.ENABLE_REQUEST_LOGGING !== "false",
    enable_error_logging: process.env.ENABLE_ERROR_LOGGING !== "false",
  },

  // ============================================================================
  // FILE UPLOAD
  // ============================================================================
  upload: {
    dir: process.env.UPLOAD_DIR || "./uploads",
    max_file_size_mb: process.env.MAX_FILE_SIZE_MB || "50",
    allowed_file_types: (process.env.ALLOWED_FILE_TYPES || "jpg,jpeg,png,pdf,doc,docx").split(","),
  },

  // ============================================================================
  // AWS S3 (Optional for file storage)
  // ============================================================================
  aws_s3: {
    access_key_id: process.env.AWS_ACCESS_KEY_ID,
    secret_access_key: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || "us-east-1",
    bucket: process.env.AWS_S3_BUCKET || "studiopass-app-bucket",
  },

  // ============================================================================
  // SOCKETS & REAL-TIME (Optional)
  // ============================================================================
  socket: {
    enabled: process.env.SOCKET_ENABLED !== "false",
    cors_origin: process.env.SOCKET_CORS_ORIGIN || "http://localhost:3000",
  },

  // ============================================================================
  // RATE LIMITING
  // ============================================================================
  rate_limit: {
    window_ms: process.env.RATE_LIMIT_WINDOW_MS || "900000",
    max_requests: process.env.RATE_LIMIT_MAX_REQUESTS || "100",
  },

  // ============================================================================
  // CORS & SECURITY
  // ============================================================================
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    credentials: process.env.CORS_CREDENTIALS !== "false",
  },

  // ============================================================================
  // ENVIRONMENT-SPECIFIC URLS
  // ============================================================================
  urls: {
    frontend_url: process.env.FRONTEND_URL || "http://localhost:3000",
    api_base_url: process.env.API_BASE_URL || "http://localhost:5003",
    webhook_url: process.env.WEBHOOK_URL || "http://localhost:5003/webhooks",
  },
};
