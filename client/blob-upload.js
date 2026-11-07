import { uploadPresigned } from '@vercel/blob/client';

globalThis.uploadModelBlob = uploadPresigned;
