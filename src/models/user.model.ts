export interface ConnectionUser {
  _id?: string;
  label: string;
  username: string;
  authType: 'password' | 'key' | 'agent';
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}
