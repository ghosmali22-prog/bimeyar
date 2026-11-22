// Web OAuth Client ID for "Sign in with Google" (basic scopes only: openid, email, profile).
// Public value, not a secret.
export const GOOGLE_CLIENT_ID = '519755009610-vqs6e182v4rv7p0gu25thalqefrps3lt.apps.googleusercontent.com';

// URL of the deployed Apps Script web app (ends with /exec). All Drive work happens there.
export const API_URL = 'https://script.google.com/macros/s/AKfycbxbtAtT-NsQwT9rgRD6oIgKUuTb5Tx_jnfNcJbtE2m2Q9wuVBRFkQChsvqg5iB3z-UF/exec';

// Largest file the backend accepts (photos are compressed before this check)
export const MAX_UPLOAD_MB = 25;

// Largest total size sent to the AI in one go (photos are compressed first)
export const MAX_AI_MB = 15;

export const APP_VERSION = '4.5.3';

/**
 * The 4 sub-folders of every customer folder. Must match SUBFOLDERS in backend/Code.gs.
 * `slot` is the stable key stored in Drive; `th` is the folder name; `en` is the small English label.
 */
export const FOLDERS = [
  { slot: 'policy', th: '01_กรมธรรม์', en: 'Policy', icon: 'shield', type: 'policy' },
  { slot: 'docs', th: '02_เอกสาร', en: 'Documents', icon: 'idcard', type: 'car' },
  { slot: 'prev', th: '03_กรมธรรม์เดิม', en: 'Previous policy', icon: 'history', type: 'policy' },
  { slot: 'pay', th: '04_หลักฐานการชำระเงิน', en: 'Payment receipts', icon: 'receipt', type: 'payment' },
];

export const VAT_RATE = 7;
