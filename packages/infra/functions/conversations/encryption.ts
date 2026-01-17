import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms';

const kms = new KMSClient({});
const KMS_KEY_ARN = process.env.KMS_KEY_ARN;

export interface EncryptionContext {
  conversationId: string;
  messageId: string;
  userId: string;
}

/**
 * Encrypts message content using KMS with encryption context for integrity.
 * The encryption context acts as Additional Authenticated Data (AAD),
 * ensuring the ciphertext can only be decrypted with the same context.
 */
export async function encryptContent(
  plaintext: string,
  context: EncryptionContext
): Promise<string> {
  if (!KMS_KEY_ARN) {
    throw new Error('KMS_KEY_ARN environment variable is not set');
  }

  const response = await kms.send(new EncryptCommand({
    KeyId: KMS_KEY_ARN,
    Plaintext: Buffer.from(plaintext, 'utf-8'),
    EncryptionContext: {
      conversationId: context.conversationId,
      messageId: context.messageId,
      userId: context.userId,
    },
  }));

  if (!response.CiphertextBlob) {
    throw new Error('KMS encryption failed - no ciphertext returned');
  }

  return Buffer.from(response.CiphertextBlob).toString('base64');
}

/**
 * Decrypts message content using KMS with encryption context.
 * The same encryption context used during encryption must be provided.
 */
export async function decryptContent(
  ciphertext: string,
  context: EncryptionContext
): Promise<string> {
  const response = await kms.send(new DecryptCommand({
    CiphertextBlob: Buffer.from(ciphertext, 'base64'),
    EncryptionContext: {
      conversationId: context.conversationId,
      messageId: context.messageId,
      userId: context.userId,
    },
  }));

  if (!response.Plaintext) {
    throw new Error('KMS decryption failed - no plaintext returned');
  }

  return new TextDecoder().decode(response.Plaintext);
}

/**
 * Batch decrypt multiple messages for efficient retrieval.
 */
export async function batchDecryptMessages(
  messages: Array<{ ciphertext: string; context: EncryptionContext }>
): Promise<string[]> {
  const decryptPromises = messages.map(({ ciphertext, context }) =>
    decryptContent(ciphertext, context)
  );
  return Promise.all(decryptPromises);
}
