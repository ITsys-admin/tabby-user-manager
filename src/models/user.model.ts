export interface ConnectionUser {
  _id?: string;
  label: string;
  username: string;
  authType: 'password' | 'key' | 'agent';
  password?: string;
  privateKeyPath?: string;
  notes?: string;
  /** True when a stored secret could not be decrypted (e.g. the key file was lost). */
  secretUnreadable?: boolean;
  createdAt: Date;
  updatedAt: Date;
}
