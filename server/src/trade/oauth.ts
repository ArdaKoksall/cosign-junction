import type { Response } from "express";
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  InvalidGrantError,
  InvalidTokenError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidClientMetadataError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { PoolClient } from "pg";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { TradeDb, hash, secret, id, TradeError, requireValue } from "./db.js";

export const SCOPES = ["catalog:read", "requests:write", "orders:write"];
export class TradeOAuth implements OAuthServerProvider {
  constructor(
    readonly db: TradeDb,
    readonly origin: string,
    private readonly encryptionKey: string,
  ) {
    if (!/^[a-f0-9]{64}$/i.test(encryptionKey))
      throw new Error(
        "OAUTH_ENCRYPTION_KEY must be 32 random bytes encoded as hex",
      );
  }
  private encrypt(value: string) {
    const iv = randomBytes(12),
      cipher = createCipheriv(
        "aes-256-gcm",
        Buffer.from(this.encryptionKey, "hex"),
        iv,
      );
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);
    return [
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }
  private decrypt(value: string) {
    const [iv, tag, data] = value.split(".");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(this.encryptionKey, "hex"),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(data, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
  get resource() {
    return `${this.origin}/mcp`;
  }
  get issuer() {
    return new URL(this.origin).href;
  }
  clientsStore = {
    getClient: async (
      clientId: string,
    ): Promise<OAuthClientInformationFull | undefined> => {
      const metadata = (
        await this.db.one("SELECT metadata FROM trade_clients WHERE id=$1", [
          clientId,
        ])
      )?.metadata;
      return metadata
        ? {
            ...metadata,
            ...(metadata.client_secret
              ? { client_secret: this.decrypt(metadata.client_secret) }
              : {}),
          }
        : undefined;
    },
    registerClient: async (
      input: Omit<
        OAuthClientInformationFull,
        "client_id" | "client_id_issued_at"
      >,
    ): Promise<OAuthClientInformationFull> => {
      if (
        input.token_endpoint_auth_method &&
        !["none", "client_secret_post"].includes(
          input.token_endpoint_auth_method,
        )
      ) {
        throw new InvalidClientMetadataError(
          "Supported methods: none and client_secret_post, both with PKCE",
        );
      }
      for (const uri of input.redirect_uris) {
        const url = new URL(uri);
        if (
          url.hash ||
          url.username ||
          url.password ||
          (url.protocol !== "https:" &&
            !(
              url.protocol === "http:" &&
              ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
            ))
        ) {
          throw new InvalidClientMetadataError(
            "Redirect URIs must use HTTPS (loopback HTTP is allowed)",
          );
        }
      }
      const client: OAuthClientInformationFull = {
        ...input,
        client_id: id("client"),
        client_id_issued_at: Math.floor(Date.now() / 1000),
        token_endpoint_auth_method:
          input.token_endpoint_auth_method ?? "client_secret_post",
      };
      if (client.token_endpoint_auth_method === "none")
        delete client.client_secret;
      const stored = {
        ...client,
        ...(client.client_secret
          ? { client_secret: this.encrypt(client.client_secret) }
          : {}),
      };
      await this.db.rows(
        "INSERT INTO trade_clients(id,metadata) VALUES($1,$2)",
        [client.client_id, JSON.stringify(stored)],
      );
      return client;
    },
  };
  private checkResource(resource?: URL) {
    if (resource && resource.href !== this.resource)
      throw new InvalidTargetError("Incorrect resource audience");
  }
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ) {
    this.checkResource(params.resource);
    const scopes = params.scopes?.length ? params.scopes : SCOPES;
    if (scopes.some((scope) => !SCOPES.includes(scope)))
      throw new InvalidScopeError("Unknown permission");
    const pending = secret();
    await this.db.rows(
      "INSERT INTO trade_authorizations(hash,client_id,params,expires_at) VALUES($1,$2,$3,now()+interval '10 minutes')",
      [
        hash(pending),
        client.client_id,
        JSON.stringify({ ...params, resource: this.resource, scopes }),
      ],
    );
    res.redirect(`${this.origin}/?authorize=${encodeURIComponent(pending)}`);
  }
  async pending(token: string) {
    const row = requireValue(
      await this.db.one(
        "SELECT a.params,c.metadata FROM trade_authorizations a JOIN trade_clients c ON c.id=a.client_id WHERE a.hash=$1 AND a.approved=false AND a.expires_at>now()",
        [hash(token)],
      ),
      "Connection request expired",
    );
    return {
      name: row.metadata.client_name ?? "MCP client",
      redirectUri: row.params.redirectUri,
      scopes: row.params.scopes,
    };
  }
  async consent(pending: string, accountId: string, allow: boolean) {
    return this.db.transaction(async (tx) => {
      const row = requireValue(
        await this.db.one(
          "DELETE FROM trade_authorizations WHERE hash=$1 AND approved=false AND expires_at>now() RETURNING *",
          [hash(pending)],
          tx,
        ),
        "Connection request expired",
      );
      const url = new URL(row.params.redirectUri);
      if (row.params.state) url.searchParams.set("state", row.params.state);
      url.searchParams.set("iss", this.issuer);
      if (!allow) {
        url.searchParams.set("error", "access_denied");
        return url.href;
      }
      const code = secret();
      await this.db.rows(
        "INSERT INTO trade_authorizations(hash,client_id,account_id,params,expires_at,approved) VALUES($1,$2,$3,$4,now()+interval '2 minutes',true)",
        [hash(code), row.client_id, accountId, JSON.stringify(row.params)],
        tx,
      );
      url.searchParams.set("code", code);
      return url.href;
    });
  }
  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
  ) {
    const row = await this.db.one(
      "SELECT params FROM trade_authorizations WHERE hash=$1 AND client_id=$2 AND approved AND expires_at>now()",
      [hash(code), client.client_id],
    );
    if (!row) throw new InvalidGrantError("Invalid authorization code");
    return row.params.codeChallenge as string;
  }
  private async issue(
    grantId: string,
    scopes: string[],
    tx: PoolClient,
  ): Promise<OAuthTokens> {
    const access = secret(),
      refresh = secret();
    await this.db.rows(
      "INSERT INTO trade_tokens(hash,grant_id,kind,expires_at) VALUES($1,$3,'access',now()+interval '15 minutes'),($2,$3,'refresh',now()+interval '30 days')",
      [hash(access), hash(refresh), grantId],
      tx,
    );
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: 900,
      refresh_token: refresh,
      scope: scopes.join(" "),
    };
  }
  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    code: string,
    _verifier?: string,
    redirectUri?: string,
    resource?: URL,
  ) {
    this.checkResource(resource);
    return this.db.transaction(async (tx) => {
      const row = await this.db.one(
        "DELETE FROM trade_authorizations WHERE hash=$1 AND client_id=$2 AND approved AND expires_at>now() RETURNING *",
        [hash(code), client.client_id],
        tx,
      );
      if (!row || !redirectUri || row.params.redirectUri !== redirectUri)
        throw new InvalidGrantError(
          "Invalid authorization code or redirect URI",
        );
      const grantId = id("grant");
      await this.db.rows(
        "INSERT INTO trade_grants(id,account_id,client_id,scopes) VALUES($1,$2,$3,$4)",
        [grantId, row.account_id, client.client_id, row.params.scopes],
        tx,
      );
      return this.issue(grantId, row.params.scopes, tx);
    });
  }
  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    token: string,
    scopes?: string[],
    resource?: URL,
  ) {
    this.checkResource(resource);
    return this.db.transaction(async (tx) => {
      const row = await this.db.one(
        "SELECT g.* FROM trade_tokens t JOIN trade_grants g ON g.id=t.grant_id WHERE t.hash=$1 AND t.kind='refresh' AND t.expires_at>now() AND g.client_id=$2 AND g.revoked_at IS NULL FOR UPDATE OF g",
        [hash(token), client.client_id],
        tx,
      );
      if (!row) throw new InvalidGrantError("Invalid refresh token");
      const deleted = await this.db.one(
        "DELETE FROM trade_tokens WHERE hash=$1 RETURNING hash",
        [hash(token)],
        tx,
      );
      if (!deleted)
        throw new InvalidGrantError("Refresh token already consumed");
      if (scopes?.some((scope) => !row.scopes.includes(scope)))
        throw new InvalidScopeError("Cannot increase permissions");
      // Retain grant scopes; reject narrowing rather than issuing a token with misleading metadata.
      if (scopes && [...scopes].sort().join() !== [...row.scopes].sort().join())
        throw new InvalidScopeError("Reconnect to change permissions");
      return this.issue(row.id, row.scopes, tx);
    });
  }
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const row = await this.db.one(
      "SELECT t.expires_at,g.* FROM trade_tokens t JOIN trade_grants g ON g.id=t.grant_id WHERE t.hash=$1 AND t.kind='access' AND t.expires_at>now() AND g.revoked_at IS NULL",
      [hash(token)],
    );
    if (!row) throw new InvalidTokenError("Expired or revoked access token");
    return {
      token,
      clientId: row.client_id,
      scopes: row.scopes,
      expiresAt: Math.floor(row.expires_at.getTime() / 1000),
      resource: new URL(this.resource),
      extra: { accountId: row.account_id, actorId: row.id },
    };
  }
  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ) {
    await this.db.rows(
      "UPDATE trade_grants SET revoked_at=now() WHERE client_id=$1 AND id IN (SELECT grant_id FROM trade_tokens WHERE hash=$2)",
      [client.client_id, hash(request.token)],
    );
  }
}
