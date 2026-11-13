export const MAX_TIMER_DELAY_MS = 2_147_483_647

export const DSH_ENV_PREFIX = 'DSH_' as const

export const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/i

export function scrubbedParentEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !SENSITIVE_ENV_PATTERN.test(key) && !key.toUpperCase().startsWith(DSH_ENV_PREFIX)) env[key] = value
  }
  return env
}

declare const credentialKeyBrand: unique symbol
export type CredentialKey = string & { readonly [credentialKeyBrand]: true }

const KEY_SEGMENT_PATTERN = /^[a-z][a-z0-9-]*$/

export function credentialKey(scope: string, id: string): CredentialKey {
  for (const segment of [scope, id]) {
    if (!KEY_SEGMENT_PATTERN.test(segment)) {
      throw new TypeError(`credential key segment "${segment}" must match ${String(KEY_SEGMENT_PATTERN)}`)
    }
  }
  return `${scope}/${id}` as CredentialKey
}

export interface CredentialRecordStore {
  describeRecord(key: CredentialKey): Promise<{ configured: boolean; writable: boolean }>
  readRecord(key: CredentialKey): Promise<unknown>
  modifyRecord(key: CredentialKey, mutate: (current: unknown) => Promise<unknown>): Promise<unknown>
}

const IMAGE_ADMISSION_ERROR_CODES = [
  'TOO_MANY_IMAGES',
  'IMAGES_TOO_LARGE',
  'UNSUPPORTED_IMAGE_TYPE',
  'INVALID_IMAGE_BASE64',
  'INVALID_IMAGE',
  'IMAGE_TYPE_MISMATCH',
  'IMAGE_TOO_LARGE',
  'IMAGE_TOO_MANY_PIXELS',
  'IMAGE_DIMENSION_TOO_LARGE'
] as const

const IMAGE_ADMISSION_ERROR_CODE_SET: ReadonlySet<string> = new Set(IMAGE_ADMISSION_ERROR_CODES)

export function isImageAdmissionError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && typeof (error as { code?: unknown }).code === 'string' && IMAGE_ADMISSION_ERROR_CODE_SET.has((error as { code: string }).code)
}

export type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

export interface SaveImageAttachment {
  data: Buffer
  mediaType: ImageMediaType
}

export interface AttachmentStoreLike {
  saveImages(images: readonly SaveImageAttachment[]): Promise<readonly unknown[]>
}
