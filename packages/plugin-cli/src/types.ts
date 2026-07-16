export interface StoredSession {
  readonly accessToken: string;
  readonly publisherId: string;
  readonly publisherSlug?: string;
  readonly portalOrigin?: string;
  readonly expiresAt: string;
  readonly scopes: readonly string[];
}

export interface CredentialsFile {
  readonly version: 1;
  readonly servers: Readonly<Record<string, StoredSession>>;
}

export interface ApiEnvelope<T> {
  readonly code: string;
  readonly message?: string;
  readonly data: T;
}

export interface DeviceAuthorization {
  readonly device_code: string;
  readonly user_code: string;
  readonly verification_uri: string;
  readonly expires_in: number;
  readonly interval: number;
}

export type DevicePoll =
  | { readonly status: 'pending'; readonly interval: number }
  | { readonly status: 'denied' | 'expired' | 'consumed' }
  | {
      readonly status: 'approved';
      readonly access_token: string;
      readonly expires_at: string;
      readonly publisher_id: string;
      readonly scopes: readonly string[];
    };

export interface RemotePlugin {
  readonly id: string;
  readonly extension_id: string;
  readonly name: string;
  readonly display_name: string;
  readonly latest_version: string | null;
}

export interface UploadGrant {
  readonly submission_id: string;
  readonly upload_url: string;
  readonly method: 'PUT';
  readonly headers: Readonly<Record<string, string>>;
  readonly expires_at: string;
}
