// Prints a private ES256 JWK for Supabase "JWT Keys → create standby key → import".
// Run once; paste the output into the dashboard and into SUPABASE_JWT_PRIVATE_JWK. Never commit it.
import { generateKeyPairSync, randomUUID } from "node:crypto";

const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = { ...privateKey.export({ format: "jwk" }), kid: randomUUID(), alg: "ES256", use: "sig" };
console.log(JSON.stringify(jwk));
