# Tabby User Manager

[License: MIT](https://opensource.org/licenses/MIT) [Tabby Plugin](https://tabby.sh)

**Tabby User Manager** is an embedded credential and user database manager for [Tabby Terminal](https://tabby.sh). It allows you to centralize SSH credentials (passwords, private keys, passphrases) in an encrypted local database and bulk-apply them across your Tabby SSH profiles or profile groups.

---

## 🚀 Features

- 🔐 **Secure Local Database**: Stores user accounts locally using NeDB with AES-256-GCM encryption for passwords and private key passphrases using a random key generated on first run (“users\_db.key”, permissions 0600, next to “users\_db.json” in Tabby's config folder). Anyone who can read both files, or your user account, can decrypt them. This protects against casual disclosure (backups, screen shares, syncing only the database), not against a compromised account. Back up the key file together with the database, or the stored passwords become unreadable.
- ⚡ **Bulk Assignment**: Easily assign saved credentials to multiple SSH profiles simultaneously. ***Applying a user to a profile*** writes the password to config.yaml in **plain text** (the password field of each profile), whether or not Tabby's vault is enabled. This lets Tabby connect without asking for the vault passphrase each time. Anyone who can read that file, or a backup or sync of it, can read those passwords. ***Strongly recommended:*** enable Tabby's vault (Settings → Vault) and **turn on config file encryption so config.yaml is encrypted at rest**, and never commit or share the file. Prefer key or agent authentication where possible, since no secret is written to the config for those.
- 📁 **Group Management**: Apply a single credential user to entire profile groups with one click.
- 🔄 **Automatic Sync**: Updating a user's password or key automatically syncs across all linked SSH profiles.
- 🎨 **Integrated UI**: Seamless tab component integrated natively into Tabby's Settings screen.

---

## 🛠️ Installation

### Via Tabby Plugin Manager (Recommended)

1. Open **Tabby**.
2. Go to **Settings** \> **Plugins**.
3. Search for `tabby-user-manager`.
4. Click **Install** and restart Tabby.

### Manual Installation

Clone this repository into your Tabby plugins directory:

```
# macOS
cd ~/Library/Application\ Support/tabby/plugins

# Linux
cd ~/.config/tabby/plugins

# Windows (PowerShell)
cd $env:APPDATA/tabby/plugins

git clone https://github.com/ITsys-admin/tabby-user-manager.git
npm install
npm run build
```

---

## 📋 Usage Guide

1. Open **Settings** in Tabby.
2. Select **User Manager** from the left navigation panel.
3. **Add New User**:
    - Set a **Profile Label / Alias** (e.g., `Production Root`).
    - Enter the **Username**.
    - Choose the **Authentication Type** (`Password` or `Private Key`).
    - Enter credentials and click **Save User**.
4. **Assign Credentials**:
    - Select the user from the list.
    - Choose assignment mode (`Select Multiple Profiles` or `Select Multiple Groups`).
    - Check the target profiles/groups and click **Apply to Selection**.

---

## 🛠️ Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v16 or higher)
- [npm](https://www.npmjs.com/)

### Build Scripts

- **Test mode:**\
  npm test
- **Production build:**\
  npm run build

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
