import { Injectable } from '@angular/core';
import { ConfigService, ProfilesService, VAULT_SECRET_TYPE_FILE, VaultService } from 'tabby-core';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConnectionUser } from './models/user.model';
import { decrypt, encrypt, loadOrCreateKey, migrateSecret } from './crypto';

const Datastore = require('nedb-promises');

const SECRET_FIELDS = ['password', 'passphrase', 'privateKeyPath'] as const;
const EDITABLE_FIELDS = ['label', 'username', 'authType', 'password', 'privateKeyPath', 'notes'] as const;
const VAULT_FILE_PREFIX = 'vault://';

@Injectable({ providedIn: 'root' })
export class UserDatabaseService {
  private db: any;
  private dbPath: string;
  private key: Buffer;
  private ready: Promise<void>;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private config: ConfigService,
    private profilesService: ProfilesService,
    private vault: VaultService
  ) {
    const appDataPath = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config'));
    const dataDir = path.join(appDataPath, 'tabby');
    this.dbPath = path.join(dataDir, 'users_db.json');
    this.db = Datastore.create({ filename: this.dbPath, timestampData: true });

    this.ready = this.init(path.join(dataDir, 'users_db.key')).catch(err => {
      console.error('[tabby-user-manager] initialization failed:', err);
      throw err;
    });
  }

  private async init(keyPath: string): Promise<void> {
    this.key = loadOrCreateKey(keyPath);
    await this.db.load();
    await this.migrateStoredSecrets();
    await this.afterWrite();
  }

  private validateAuthInput(user: Partial<ConnectionUser>): void {
    const authType = user.authType;
    if (authType === undefined) return;

    if (authType === 'password') {
      if (typeof user.password !== 'string' || user.password.trim() === '') {
        throw new Error('Password auth requires a non-empty password');
      }
      delete user.privateKeyPath;
      return;
    }

    if (authType === 'key') {
      if (typeof user.privateKeyPath !== 'string' || user.privateKeyPath.trim() === '') {
        throw new Error('Key auth requires a non-empty privateKeyPath');
      }
      user.privateKeyPath = this.normalizePrivateKeyPath(user.privateKeyPath);
      delete user.password;
      return;
    }

    delete user.password;
    delete user.privateKeyPath;
  }

  private normalizePrivateKeyPath(value?: string): string | undefined {
    if (!value) return undefined;

    let expanded = value.trim();
    if (expanded === '~') {
      expanded = os.homedir();
    } else if (expanded.startsWith('~/') || expanded.startsWith('~\\')) {
      expanded = path.join(os.homedir(), expanded.slice(2));
    }

    const normalized = path.resolve(expanded);
    try {
      fs.accessSync(normalized, fs.constants.R_OK);
    } catch {
      throw new Error(`Private key is missing or unreadable: ${normalized}`);
    }
    return normalized;
  }

  /** Upgrades v1.x records (CBC / hostname-derived key / plaintext) to the current format. */
  private async migrateStoredSecrets(): Promise<void> {
    const docs = await this.db.find({});
    for (const doc of docs) {
      const set: any = {};
      for (const field of SECRET_FIELDS) {
        const value = doc[field];
        if (!value) continue;
        const migrated = migrateSecret(this.key, value, field);
        if (migrated === null) {
          console.warn(`[tabby-user-manager] could not migrate ${field} of user ${doc._id}; re-enter it in the plugin`);
        } else if (migrated !== value) {
          set[field] = migrated;
        }
      }
      if (Object.keys(set).length) {
        await this.db.update({ _id: doc._id }, { $set: set });
      }
    }
  }

  /**
   * nedb is append-only: replaced or deleted values stay in the file until it is compacted.
   * Compact after every write so old secrets don't linger, then re-apply 0600
   * (compaction replaces the file).
   */
  private async afterWrite(): Promise<void> {
    const run = async (): Promise<void> => {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          this.db.removeListener('compactionDone', onCompactionDone);
          reject(new Error('Database compaction timed out'));
        }, 15000);

        const onCompactionDone = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        };

        this.db.once('compactionDone', onCompactionDone);
        try {
          this.db.compactDatafile();
        } catch (err) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.db.removeListener('compactionDone', onCompactionDone);
          reject(err);
        }
      }).catch(err => {
        console.warn('[tabby-user-manager] compaction failed:', err);
      });

      await this.lockDown();
    };

    this.writeQueue = this.writeQueue.then(run, run);
    await this.writeQueue;
  }

  private async lockDown(): Promise<void> {
    try { await fs.promises.chmod(this.dbPath, 0o600); } catch { /* best effort (e.g. Windows) */ }
  }

  /** Read-only check used for the UI warning; never unlocks or prompts for the vault. */
  isVaultEnabled(): boolean {
    return this.vault.isEnabled();
  }

  private toPublic(doc: any, strict: boolean): ConnectionUser {
    const { passphrase, ...rest } = doc;
    const result: ConnectionUser = { ...rest };
    try {
      result.password = decrypt(this.key, doc.password, 'password');
    } catch (e) {
      if (strict) throw new Error(`Stored password for "${doc.label}" cannot be decrypted`);
      result.password = undefined;
      result.secretUnreadable = true;
    }
    try {
      result.privateKeyPath = decrypt(this.key, doc.privateKeyPath, 'privateKeyPath');
    } catch (e) {
      if (strict) throw new Error(`Stored private key path for "${doc.label}" cannot be decrypted`);
      result.privateKeyPath = undefined;
      result.secretUnreadable = true;
    }
    return result;
  }

  async getAllUsers(): Promise<ConnectionUser[]> {
    await this.ready;
    const users = await this.db.find({ disabled: { $ne: true } }).sort({ label: 1 });
    return users.map((u: any) => this.toPublic(u, false));
  }

  /** Strict: throws if the secret can't be decrypted, so garbage is never applied to a profile. */
  async getUserById(id: string): Promise<ConnectionUser | null> {
    await this.ready;
    const user = await this.db.findOne({ _id: id, disabled: { $ne: true } });
    return user ? this.toPublic(user, true) : null;
  }

  private pickEditable(user: Partial<ConnectionUser>): any {
    const out: any = {};
    for (const f of EDITABLE_FIELDS) {
      if ((user as any)[f] !== undefined) out[f] = (user as any)[f];
    }
    return out;
  }

  async addUser(user: Omit<ConnectionUser, '_id' | 'createdAt' | 'updatedAt'>): Promise<ConnectionUser> {
    await this.ready;
    const doc = this.pickEditable(user);
    this.validateAuthInput(doc);
    if (doc.authType !== 'password') delete doc.password;
    if (doc.authType !== 'key') delete doc.privateKeyPath;
    if (doc.authType === 'password') doc.password = encrypt(this.key, doc.password, 'password');
    if (doc.authType === 'key') doc.privateKeyPath = encrypt(this.key, doc.privateKeyPath, 'privateKeyPath');
    const inserted = await this.db.insert(doc);
    await this.afterWrite();
    return this.toPublic(inserted, true);
  }

  async updateUser(id: string, user: Partial<ConnectionUser>): Promise<number> {
    await this.ready;
    const existing = await this.db.findOne({ _id: id, disabled: { $ne: true } });
    if (!existing) return 0;

    const next = { ...this.toPublic(existing, true), ...user };
    this.validateAuthInput(next);

    const set = this.pickEditable(user);
    if (set.privateKeyPath !== undefined) set.privateKeyPath = this.normalizePrivateKeyPath(set.privateKeyPath);
    const unset: any = {};
    if (set.password !== undefined) set.password = encrypt(this.key, set.password, 'password');
    if (set.privateKeyPath !== undefined) set.privateKeyPath = encrypt(this.key, set.privateKeyPath, 'privateKeyPath');
    if (set.authType && set.authType !== 'password') { delete set.password; unset.password = true; }
    if (set.authType && set.authType !== 'key') { delete set.privateKeyPath; unset.privateKeyPath = true; }

    const update: any = { $set: set };
    if (Object.keys(unset).length) update.$unset = unset;
    const numUpdated = await this.db.update({ _id: id, disabled: { $ne: true } }, update);
    await this.afterWrite();

    const updatedUser = await this.getUserById(id);
    if (updatedUser) {
      let configChanged = false;
      for (const profile of this.config.store.profiles) {
        if (profile.type === 'ssh' && profile.options?.managedUserId === id) {
          await this.applyToProfile(profile, updatedUser);
          configChanged = true;
        }
      }
      if (configChanged) await this.config.save();
    }
    return numUpdated;
  }

  async deleteUser(id: string): Promise<number> {
    await this.ready;
    let configChanged = false;
    for (const profile of this.config.store.profiles) {
      if (profile.type === 'ssh' && profile.options?.managedUserId === id) {
        delete profile.options.user;
        delete profile.options.password;
        delete profile.options.privateKeys;
        delete profile.options.auth;
        delete profile.options.managedUserId;
        configChanged = true;
      }
    }
    if (configChanged) await this.config.save();

    // Soft delete: keep the record (label, username, dates) for tracking, but drop its secrets.
    const disabled = await this.db.update(
      { _id: id },
      { $set: { disabled: true, disabledAt: new Date() }, $unset: { password: true, passphrase: true, privateKeyPath: true } }
    );
    await this.afterWrite();
    return disabled;
  }

  // ---- Applying a user to Tabby SSH profiles ----

  /**
   * Writes the user's credentials using the option names Tabby SSH reads. When the vault is
   * enabled, private key contents are stored there and the profile references them by vault URI.
   */
  private async applyToProfile(profile: any, user: ConnectionUser): Promise<void> {
    profile.options = profile.options ?? {};
    const opts = profile.options;

    opts.user = user.username;
    opts.managedUserId = user._id;
    // Remove leftovers from plugin v1.1.x, which wrote fields Tabby ignores.
    delete opts.privateKeyPath;
    delete opts.passphrase;

    if (user.authType === 'password') {
      opts.auth = 'password';
      delete opts.privateKeys;
      opts.password = user.password;
    } else if (user.authType === 'key') {
      const keyPath = user.privateKeyPath ? this.normalizePrivateKeyPath(user.privateKeyPath) : undefined;
      opts.auth = 'publicKey';
      if (keyPath && this.vault.isEnabled()) {
        if (!user._id) {
          throw new Error('Save this user before adding its private key to Tabby’s vault.');
        }

        await this.vault.getPassphrase();
        const id = `tabby-user-manager-${user._id}`;
        const contents = await fs.promises.readFile(keyPath);
        await this.vault.addSecret({
          type: VAULT_SECRET_TYPE_FILE,
          key: { id, description: `SSH private key for ${user.label}` },
          value: contents.toString('base64'),
        });
        const stored = await this.vault.getSecret(VAULT_SECRET_TYPE_FILE, { id });
        if (!stored) {
          throw new Error('Could not store the private key in Tabby’s vault.');
        }
        opts.privateKeys = [`${VAULT_FILE_PREFIX}${id}`];
      } else {
        opts.privateKeys = keyPath ? [keyPath] : [];
      }
      delete opts.password;
    } else {
      opts.auth = 'agent';
      delete opts.privateKeys;
      delete opts.password;
    }
  }

  async getSSHProfiles(): Promise<any[]> {
    const profiles = await this.profilesService.getProfiles();
    return profiles.filter(p => p.type === 'ssh').map(p => {
      let groupName = '';
      if (p.group) {
        try {
          groupName = (this.profilesService as any).resolveProfileGroupName
            ? (this.profilesService as any).resolveProfileGroupName(p.group)
            : p.group;
        } catch (e) {
          groupName = p.group;
        }
      }
      return { ...p, groupName };
    });
  }

  async getSSHGroups(): Promise<{ id: string, name: string }[]> {
    try {
      const groups = await (this.profilesService as any).getProfileGroups?.();
      if (groups && groups.length > 0) {
        return groups.map((g: any) => ({ id: g.id, name: g.name || g.id }));
      }
    } catch (e) {
      // Fallback below if the method is missing
    }

    const profiles = this.config.store.profiles || [];
    const groupMap = new Map<string, string>();
    for (const p of profiles) {
      if (p.type === 'ssh' && p.group) {
        const gName = (this.profilesService as any).resolveProfileGroupName
          ? (this.profilesService as any).resolveProfileGroupName(p.group)
          : p.group;
        groupMap.set(p.group, gName);
      }
    }
    return Array.from(groupMap.entries()).map(([id, name]) => ({ id, name }));
  }

  async applyUserToProfiles(profileIds: string[], user: ConnectionUser): Promise<void> {
    let configChanged = false;
    for (const profileId of profileIds) {
      const target = this.config.store.profiles.find((p: any) => p.id === profileId && p.type === 'ssh');
      if (target) {
        await this.applyToProfile(target, user);
        configChanged = true;
      }
    }
    if (configChanged) await this.config.save();
  }

  async applyUserToGroups(groupIdOrNames: string[], user: ConnectionUser): Promise<void> {
    const resolve = (g: string) => (this.profilesService as any).resolveProfileGroupName?.(g);
    let configChanged = false;
    for (const profile of this.config.store.profiles) {
      if (profile.type !== 'ssh' || !profile.group) continue;
      if (groupIdOrNames.includes(profile.group) || groupIdOrNames.includes(resolve(profile.group))) {
        await this.applyToProfile(profile, user);
        configChanged = true;
      }
    }
    if (configChanged) await this.config.save();
  }
}
