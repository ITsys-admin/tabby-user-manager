# Tabby User Manager

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Tabby Plugin](https://img.shields.io/badge/Tabby-Plugin-blue)](https://tabby.sh)

**Tabby User Manager** is an embedded credential and user database manager for [Tabby Terminal](https://tabby.sh). It allows you to centralize SSH credentials (passwords, private keys, passphrases) in an encrypted local database and bulk-apply them across your Tabby SSH profiles or profile groups.

---

## 🚀 Features

* 🔐 **Secure Local Database**: Stores user accounts locally using NeDB with AES-256-CBC encryption for passwords and private key passphrases.
* ⚡ **Bulk Assignment**: Easily assign saved credentials to multiple SSH profiles simultaneously.
* 📁 **Group Management**: Apply a single credential user to entire profile groups with one click.
* 🔄 **Automatic Sync**: Updating a user's password or key automatically syncs across all linked SSH profiles.
* 🎨 **Integrated UI**: Seamless tab component integrated natively into Tabby's Settings screen.

---

## 🛠️ Installation

### Via Tabby Plugin Manager (Recommended)
1. Open **Tabby**.
2. Go to **Settings** > **Plugins**.
3. Search for `tabby-user-manager`.
4. Click **Install** and restart Tabby.

### Manual Installation
Clone this repository into your Tabby plugins directory:

```bash
# macOS
cd ~/Library/Application\ Support/tabby/plugins

# Linux
cd ~/.config/tabby/plugins

# Windows (PowerShell)
cd $env:APPDATA/tabby/plugins

git clone https://github.com/saljos1985/tabby-user-manager.git
cd tabby-user-manager
npm install
npm run build
```

---

## 📋 Usage Guide

1. Open **Settings** in Tabby.
2. Select **User Manager** from the left navigation panel.
3. **Add New User**:
   * Set a **Profile Label / Alias** (e.g., `Production Root`).
   * Enter the **Username**.
   * Choose the **Authentication Type** (`Password` or `Private Key`).
   * Enter credentials and click **Save User**.
4. **Assign Credentials**:
   * Select the user from the list.
   * Choose assignment mode (`Select Multiple Profiles` or `Select Multiple Groups`).
   * Check the target profiles/groups and click **Apply to Selection**.

---

## 🛠️ Development

### Prerequisites
* [Node.js](https://nodejs.org/) (v16 or higher)
* [npm](https://www.npmjs.com/)

### Build Scripts

* **Development mode (watch):**
  ```bash
  npm run dev
  ```
* **Production build:**
  ```bash
  npm run build
  ```

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.