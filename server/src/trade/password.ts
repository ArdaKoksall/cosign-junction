import { scrypt as rawScrypt, randomBytes, timingSafeEqual } from "node:crypto";
const scrypt = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) => {
    rawScrypt(
      password,
      salt,
      64,
      { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
export async function passwordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt);
  return `${salt}:${key.toString("hex")}`;
}
export async function passwordMatches(password: string, encoded: string) {
  const [salt, encodedKey] = encoded.split(":");
  const actual = await scrypt(password, salt);
  const expected = Buffer.from(encodedKey, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
