const SHA256_HEX = /^[a-f0-9]{64}$/;

export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX.test(value);
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("INTEGRITY_CHECK_UNAVAILABLE");
  const bytes =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  const buffer = Uint8Array.from(bytes).buffer;
  const digest = await subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function assertSha256Integrity(
  value: string | Uint8Array,
  expectedSha256: string,
  errorCode: string,
): Promise<void> {
  if (!isSha256Hex(expectedSha256)) throw new Error(errorCode);
  try {
    if ((await sha256Hex(value)) !== expectedSha256) {
      throw new Error(errorCode);
    }
  } catch (error) {
    if (error instanceof Error && error.message === errorCode) throw error;
    throw new Error(errorCode);
  }
}
