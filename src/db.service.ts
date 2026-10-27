import { Injectable } from '@angular/core';
import { ConfigService, ProfilesService } from 'tabby-core';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { ConnectionUser } from './models/user.model';

const Datastore = require('nedb-promises');

const ENCRYPTION_KEY = crypto.scryptSync(os.hostname() + os.userInfo().username, 'tabby-user-manager-salt', 32);
const IV_LENGTH = 16;

function encrypt(text?: string): string | undefined {
  if (!text) return text;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text?: string): string | undefined {
  if (!text || !text.includes(':')) return text;
  try {
    const [ivHex, encryptedHex] = text.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const encryptedText = Buffer.from(encryptedHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
    const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (e) {
    return text;
  }
}

@Injectable({ providedIn: 'root' })
export class UserDatabaseService {
  private db: any;

  constructor(
    private config: ConfigService,
    private profilesService: ProfilesService
  ) {
    const appDataPath = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config'));
    const dbPath = path.join(appDataPath, 'tabby', 'users_db.json');
    
    this.db = Datastore.create({
      filename: dbPath,
      autoload: true,
      timestampData: true
    });
  }

  async getAllUsers(): Promise<ConnectionUser[]> {
    const users = await this.db.find({}).sort({ label: 1 });
    return users.map((u: ConnectionUser) => ({
      ...u,
      password: decrypt(u.password),
      passphrase: decrypt(u.passphrase)
    }));
  }

  async getUserById(id: string): Promise<ConnectionUser | null> {
    const user = await this.db.findOne({ _id: id });
    if (!user) return null;
    return {
      ...user,
      password: decrypt(user.password),
      passphrase: decrypt(user.passphrase)
    };
  }

  async addUser(user: Omit<ConnectionUser, '_id' | 'createdAt' | 'updatedAt'>): Promise<ConnectionUser> {
    const secureUser = {
      ...user,
      password: encrypt(user.password),
      passphrase: encrypt(user.passphrase)
    };
    const inserted = await this.db.insert(secureUser);
    return {
      ...inserted,
      password: decrypt(inserted.password),
      passphrase: decrypt(inserted.passphrase)
    };
  }

  async updateUser(id: string, user: Partial<ConnectionUser>): Promise<number> {
    const secureUpdate: Partial<ConnectionUser> = { ...user };
    if (secureUpdate.password !== undefined) {
      secureUpdate.password = encrypt(secureUpdate.password);
    }
    if (secureUpdate.passphrase !== undefined) {
      secureUpdate.passphrase = encrypt(secureUpdate.passphrase);
    }

    const numUpdated = await this.db.update({ _id: id }, { $set: secureUpdate });

    const updatedUser = await this.getUserById(id);
    if (updatedUser) {
      const profiles = this.config.store.profiles;
      let configChanged = false;

      for (const profile of profiles) {
        if (profile.type === 'ssh' && profile.options && profile.options.managedUserId === id) {
          profile.options.user = updatedUser.username;
          
          if (updatedUser.authType === 'password') {
            profile.options.password = updatedUser.password;
            delete profile.options.privateKeyPath;
            delete profile.options.passphrase;
          } else if (updatedUser.authType === 'key') {
            profile.options.privateKeyPath = updatedUser.privateKeyPath;
            profile.options.passphrase = updatedUser.passphrase;
            delete profile.options.password;
          }
          configChanged = true;
        }
      }

      if (configChanged) {
        this.config.save();
      }
    }

    return numUpdated;
  }

  async deleteUser(id: string): Promise<number> {
    const profiles = this.config.store.profiles;
    let configChanged = false;

    for (const profile of profiles) {
      if (profile.type === 'ssh' && profile.options && profile.options.managedUserId === id) {
        delete profile.options.user;
        delete profile.options.password;
        delete profile.options.privateKeyPath;
        delete profile.options.passphrase;
        delete profile.options.managedUserId;
        configChanged = true;
      }
    }

    if (configChanged) {
      this.config.save();
    }

    return this.db.remove({ _id: id }, {});
  }

  async getSSHProfiles(): Promise<any[]> {
    const profiles = await this.profilesService.getProfiles();
    const sshProfiles = profiles.filter(p => p.type === 'ssh');
    
    return sshProfiles.map(p => {
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
      return {
        ...p,
        groupName: groupName
      };
    });
  }

  async getSSHGroups(): Promise<{ id: string, name: string }[]> {
    try {
      const groups = await (this.profilesService as any).getProfileGroups?.();
      if (groups && groups.length > 0) {
        return groups.map((g: any) => ({
          id: g.id,
          name: g.name || g.id
        }));
      }
    } catch (e) {
      // Fallback if method is missing
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
    const profiles = this.config.store.profiles;
    let configChanged = false;

    for (const profileId of profileIds) {
      const target = profiles.find((p: any) => p.id === profileId);
      if (target) {
        if (!target.options) {
          target.options = {};
        }
        target.options.user = user.username;
        target.options.managedUserId = user._id;
        
        if (user.authType === 'password') {
          target.options.password = user.password;
          delete target.options.privateKeyPath;
          delete target.options.passphrase;
        } else if (user.authType === 'key') {
          target.options.privateKeyPath = user.privateKeyPath;
          target.options.passphrase = user.passphrase;
          delete target.options.password;
        }
        configChanged = true;
      }
    }

    if (configChanged) {
      this.config.save();
    }
  }

  async applyUserToGroup(groupIdOrName: string, user: ConnectionUser): Promise<void> {
    const profiles = this.config.store.profiles;
    let configChanged = false;

    for (const profile of profiles) {
      if (profile.type === 'ssh') {
        const matchesGroup = profile.group === groupIdOrName || 
          ((this.profilesService as any).resolveProfileGroupName && 
           (this.profilesService as any).resolveProfileGroupName(profile.group) === groupIdOrName);

        if (matchesGroup) {
          if (!profile.options) {
            profile.options = {};
          }
          profile.options.user = user.username;
          profile.options.managedUserId = user._id;
          
          if (user.authType === 'password') {
            profile.options.password = user.password;
            delete profile.options.privateKeyPath;
            delete profile.options.passphrase;
          } else if (user.authType === 'key') {
            profile.options.privateKeyPath = user.privateKeyPath;
            profile.options.passphrase = user.passphrase;
            delete profile.options.password;
          }
          configChanged = true;
        }
      }
    }

    if (configChanged) {
      this.config.save();
    }
  }

  async applyUserToGroups(groupIdOrNames: string[], user: ConnectionUser): Promise<void> {
    for (const groupId of groupIdOrNames) {
      await this.applyUserToGroup(groupId, user);
    }
  }
}
