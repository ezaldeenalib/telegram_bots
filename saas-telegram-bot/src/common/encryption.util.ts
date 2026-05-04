import * as CryptoJS from 'crypto-js';

const getKey = (): string => {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error('ENCRYPTION_KEY is not set in environment variables');
  return key;
};

export function encrypt(text: string): string {
  return CryptoJS.AES.encrypt(text, getKey()).toString();
}

export function decrypt(cipherText: string): string {
  const bytes = CryptoJS.AES.decrypt(cipherText, getKey());
  return bytes.toString(CryptoJS.enc.Utf8);
}
