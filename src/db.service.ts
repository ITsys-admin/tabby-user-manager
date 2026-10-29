import { Injectable } from '@angular/core';
import { ConfigService, ProfilesService, VaultService } from 'tabby-core';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConnectionUser } from './models/user.model';
import { decrypt, encrypt, loadOrCreateKey, migrateSecret } from './crypto';

const Datastore = require('nedb-promises');

const SECRET_FIELDS = ['password', 'passphrase'] as const;
const EDITABLE_FIELDS = ['label', 'username', 'authType', 'password', 'privateKeyPath', 'notes'] as const;

@Injectable({ providedIn: 'root' })
export class UserDatabaseService {
  private db: any;
  private dbPath: string;
  private key: Buffer;
  private ready: Promise<void>;

  constructor(
    private config: ConfigService,
    private profilesService: ProfilesService,
    private vault: VaultService
  ) {
    const appDataPath = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config'));
    const dataDir = path.join(appDataPath, 'tabby');
    this.dbPath = path.join(dataDir, 'users_db.json');
    this.db = Datastore.create({ filename: this.dbPath, timestampData: true });

    this.ready = this.init(path.join(dataDir, 'users_db.key'));
    this.ready.catch(e => console.error('[tabby-user-manager] initialization failed:', e));
  }

  private async init(keyPath: string): Promise<void> {
    this.key = loadOrCreateKey(keyPath);
    await this.db.load();
    await this.migrateStoredSecrets();
    await this.afterWrite();
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
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 5000); // never block the UI on compaction
      this.db.once('compactionDone', () => { clearTimeout(timer); resolve(); });
      this.db.compactDatafile();
    });
    await this.lockDown();
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
    if (doc.authType !== 'password') delete doc.password;
    if (doc.authType !== 'key') delete doc.privateKeyPath;
    doc.password = encrypt(this.key, doc.password, 'password');
    const inserted = await this.db.insert(doc);
    await this.afterWrite();
    return this.toPublic(inserted, true);
  }

  async updateUser(id: string, user: Partial<ConnectionUser>): Promise<number> {
    await this.ready;
    const set = this.pickEditable(user);
    const unset: any = {};
    if (set.password !== undefined) set.password = encrypt(this.key, set.password, 'password');
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
   * Writes the user's credentials into one profile using the option names Tabby actually reads
   * (`auth`, `privateKeys`, `password`). Passwords are written to config.yaml, so Tabby can
   * connect without asking for the vault passphrase. Protect the file by enabling Tabby's vault
   * (Settings → Vault), which encrypts the config file.
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
      opts.auth = 'publicKey';
      opts.privateKeys = user.privateKeyPath ? [user.privateKeyPath] : [];
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
