import "./helpers/tempDb.js";
import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "../src/lib/crypto.js";

describe("crypto", () => {
  it("round-trips arbitrary strings", () => {
    const cases = [
      "",
      "hello",
      "GOCSPX-1234567890abcdef",
      "🔑 unicode mixed with ascii",
      JSON.stringify({ access_token: "xyz", expiry_date: 1234567890 }),
      "a".repeat(4096),
    ];
    for (const pt of cases) {
      expect(decrypt(encrypt(pt))).toBe(pt);
    }
  });

  it("uses the v1 version prefix", () => {
    const blob = encrypt("whatever");
    expect(blob.startsWith("v1:")).toBe(true);
    expect(blob.split(":")).toHaveLength(4);
  });

  it("produces different ciphertext for the same plaintext (random IV)", () => {
    const a = encrypt("same-secret");
    const b = encrypt("same-secret");
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(decrypt(b));
  });

  it("rejects a tampered payload", () => {
    const blob = encrypt("sensitive");
    const parts = blob.split(":");
    // Flip a bit in the ciphertext segment.
    const ctBuf = Buffer.from(parts[3], "base64");
    ctBuf[0] ^= 0x01;
    parts[3] = ctBuf.toString("base64");
    const tampered = parts.join(":");
    expect(() => decrypt(tampered)).toThrow();
  });

  it("rejects an unknown version prefix", () => {
    expect(() => decrypt("v2:aaa:bbb:ccc")).toThrow(/unrecognized/);
    expect(() => decrypt("not-a-ciphertext")).toThrow();
  });
});
